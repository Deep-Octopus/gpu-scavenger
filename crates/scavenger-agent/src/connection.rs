use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use scavenger_protocol::control::{
    agent_message, AgentHealth, AgentHeartbeat, AgentMessage, ClaimEvent, Device, DeviceState,
};
use tokio::sync::mpsc;
use tonic::transport::{Certificate, ClientTlsConfig, Endpoint, Identity};

use crate::agent::{AgentConfig, AgentError};
use crate::claim::ClaimFile;
use crate::probe::NvmlProbe;
use scavenger_core::GpuProbe;

#[derive(Debug, Clone)]
pub struct AgentTlsConfig {
    pub ca: PathBuf,
    pub certificate: Option<PathBuf>,
    pub private_key: Option<PathBuf>,
    pub domain: String,
}

pub struct ProbeRuntime {
    pub probe: Option<Arc<NvmlProbe>>,
    pub devices: Vec<Device>,
    pub health: i32,
    pub health_reason: String,
}

pub type SharedProbeRuntime = Arc<Mutex<ProbeRuntime>>;

pub fn initialize_probe() -> SharedProbeRuntime {
    let runtime = match NvmlProbe::new().and_then(|probe| {
        let devices = probe.inventory()?;
        Ok((Arc::new(probe), devices))
    }) {
        Ok((probe, devices)) => ProbeRuntime {
            devices: device_messages(&devices),
            probe: Some(probe),
            health: AgentHealth::AgentHealthy as i32,
            health_reason: String::new(),
        },
        Err(error) => ProbeRuntime {
            probe: None,
            devices: Vec::new(),
            health: AgentHealth::AgentQuarantined as i32,
            health_reason: error.to_string(),
        },
    };
    Arc::new(Mutex::new(runtime))
}

pub fn current_probe(runtime: &SharedProbeRuntime) -> Option<Arc<NvmlProbe>> {
    runtime.lock().ok().and_then(|state| state.probe.clone())
}

pub fn health(runtime: &SharedProbeRuntime) -> (i32, String, Vec<Device>) {
    runtime
        .lock()
        .map(|state| {
            (
                state.health,
                state.health_reason.clone(),
                state.devices.clone(),
            )
        })
        .unwrap_or_else(|_| {
            (
                AgentHealth::AgentQuarantined as i32,
                "probe state lock poisoned".to_string(),
                Vec::new(),
            )
        })
}

pub fn set_quarantined(runtime: &SharedProbeRuntime, reason: impl Into<String>) {
    if let Ok(mut state) = runtime.lock() {
        state.probe = None;
        state.devices.clear();
        state.health = AgentHealth::AgentQuarantined as i32;
        state.health_reason = reason.into();
    }
}

pub fn endpoint(config: &AgentConfig) -> Result<Endpoint, AgentError> {
    let endpoint = Endpoint::from_shared(config.controller.clone())
        .map_err(|error| AgentError::Config(error.to_string()))?;
    let Some(tls) = config.tls.as_ref() else {
        return Ok(endpoint);
    };
    let ca = std::fs::read(&tls.ca).map_err(|error| AgentError::Config(error.to_string()))?;
    let mut tls_config = ClientTlsConfig::new()
        .ca_certificate(Certificate::from_pem(ca))
        .domain_name(tls.domain.clone());
    match (&tls.certificate, &tls.private_key) {
        (Some(certificate), Some(private_key)) => {
            let cert = std::fs::read(certificate)
                .map_err(|error| AgentError::Config(error.to_string()))?;
            let key = std::fs::read(private_key)
                .map_err(|error| AgentError::Config(error.to_string()))?;
            tls_config = tls_config.identity(Identity::from_pem(cert, key));
        }
        (None, None) => {}
        _ => {
            return Err(AgentError::Config(
                "TLS client certificate and key must be provided together".to_string(),
            ));
        }
    }
    endpoint
        .tls_config(tls_config)
        .map_err(|error| AgentError::Config(error.to_string()))
}

pub fn hello(runtime: &SharedProbeRuntime, agent_id: &str) -> AgentMessage {
    let (health, health_reason, devices) = health(runtime);
    AgentMessage {
        message: Some(agent_message::Message::Hello(
            scavenger_protocol::control::AgentHello {
                agent_id: agent_id.to_string(),
                devices,
                health,
                health_reason,
            },
        )),
    }
}

pub fn spawn_heartbeat(
    sender: mpsc::Sender<AgentMessage>,
    runtime: SharedProbeRuntime,
    agent_id: String,
    claim: ClaimFile,
    interval: Duration,
    connection_alive: Arc<AtomicBool>,
    health_ok: Arc<AtomicBool>,
) -> tokio::task::JoinHandle<()> {
    let interval = interval.max(Duration::from_millis(250));
    tokio::spawn(async move {
        heartbeat_loop(
            sender,
            runtime,
            agent_id,
            claim,
            interval,
            connection_alive,
            health_ok,
        )
        .await;
    })
}

async fn heartbeat_loop(
    sender: mpsc::Sender<AgentMessage>,
    runtime: SharedProbeRuntime,
    agent_id: String,
    claim: ClaimFile,
    interval: Duration,
    connection_alive: Arc<AtomicBool>,
    health_ok: Arc<AtomicBool>,
) {
    let mut ticker = tokio::time::interval(interval);
    let mut last_claim_state = None;
    loop {
        ticker.tick().await;
        if !connection_alive.load(Ordering::Acquire) {
            return;
        }
        let (devices, _, _) = refresh_probe(&runtime, &health_ok);
        let (claim_active, claim_reason) = match claim.is_active() {
            Ok(active) => (active, "claim state changed"),
            Err(error) => {
                set_quarantined(&runtime, format!("claim state unreadable: {error}"));
                health_ok.store(false, Ordering::Release);
                (true, "claim state unreadable; failing closed")
            }
        };
        if last_claim_state != Some(claim_active) {
            let message = AgentMessage {
                message: Some(agent_message::Message::Claim(ClaimEvent {
                    agent_id: agent_id.clone(),
                    device_uuid: String::new(),
                    active: claim_active,
                    reason: claim_reason.to_string(),
                })),
            };
            if sender.send(message).await.is_err() {
                return;
            }
            last_claim_state = Some(claim_active);
        }
        let (current_health, current_reason, _) = health(&runtime);
        let heartbeat = AgentMessage {
            message: Some(agent_message::Message::Heartbeat(AgentHeartbeat {
                agent_id: agent_id.clone(),
                monotonic_ms: 0,
                devices,
                health: if current_health == AgentHealth::AgentHealthy as i32 {
                    AgentHealth::AgentHealthy as i32
                } else {
                    AgentHealth::AgentQuarantined as i32
                },
                health_reason: current_reason,
            })),
        };
        if sender.send(heartbeat).await.is_err() {
            return;
        }
    }
}

fn refresh_probe(
    runtime: &SharedProbeRuntime,
    health_ok: &Arc<AtomicBool>,
) -> (Vec<DeviceState>, i32, String) {
    let probe = runtime.lock().ok().and_then(|state| state.probe.clone());
    let Some(probe) = probe else {
        let result = try_initialize(runtime);
        health_ok.store(
            result.1 == AgentHealth::AgentHealthy as i32,
            Ordering::Release,
        );
        return result;
    };
    match collect_device_states(&probe) {
        Ok((devices, states)) => {
            if let Ok(mut state) = runtime.lock() {
                state.devices = devices;
                state.health = AgentHealth::AgentHealthy as i32;
                state.health_reason.clear();
            }
            health_ok.store(true, Ordering::Release);
            (states, AgentHealth::AgentHealthy as i32, String::new())
        }
        Err(error) => {
            set_quarantined(runtime, error.to_string());
            health_ok.store(false, Ordering::Release);
            (
                Vec::new(),
                AgentHealth::AgentQuarantined as i32,
                error.to_string(),
            )
        }
    }
}

fn try_initialize(runtime: &SharedProbeRuntime) -> (Vec<DeviceState>, i32, String) {
    let result = NvmlProbe::new().and_then(|probe| {
        let probe = Arc::new(probe);
        let (devices, states) = collect_device_states(&probe)?;
        Ok((probe, devices, states))
    });
    match result {
        Ok((probe, devices, states)) => {
            if let Ok(mut state) = runtime.lock() {
                state.probe = Some(probe);
                state.devices = devices;
                state.health = AgentHealth::AgentHealthy as i32;
                state.health_reason.clear();
            }
            (states, AgentHealth::AgentHealthy as i32, String::new())
        }
        Err(error) => {
            set_quarantined(runtime, error.to_string());
            (
                Vec::new(),
                AgentHealth::AgentQuarantined as i32,
                error.to_string(),
            )
        }
    }
}

fn collect_device_states(
    probe: &NvmlProbe,
) -> Result<(Vec<Device>, Vec<DeviceState>), scavenger_core::ProbeError> {
    let devices = probe.inventory()?;
    let mut states = Vec::with_capacity(devices.len());
    for device in &devices {
        let snapshot = probe.query_snapshot(device)?;
        states.push(DeviceState {
            uuid: snapshot.device.uuid,
            free_memory_bytes: snapshot.free_memory_bytes,
            process_count: snapshot.processes.len() as u32,
        });
    }
    Ok((device_messages(&devices), states))
}

fn device_messages(devices: &[scavenger_core::GpuDeviceId]) -> Vec<Device> {
    devices
        .iter()
        .map(|device| Device {
            uuid: device.uuid.clone(),
            total_memory_bytes: 0,
        })
        .collect()
}
