use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use scavenger_protocol::control::{agent_message, AgentHeartbeat, AgentMessage, ClaimEvent};
use tokio::sync::mpsc;
use tonic::transport::{Certificate, ClientTlsConfig, Endpoint, Identity};

use crate::agent::{AgentConfig, AgentError};
use crate::claim::ClaimFile;
use crate::health::{capabilities, health, refresh_probe, set_quarantined, SharedProbeRuntime};

#[derive(Debug, Clone)]
pub struct AgentTlsConfig {
    pub ca: PathBuf,
    pub certificate: Option<PathBuf>,
    pub private_key: Option<PathBuf>,
    pub domain: String,
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

pub fn hello(
    runtime: &SharedProbeRuntime,
    agent_id: &str,
    token_file: Option<&std::path::Path>,
) -> Result<AgentMessage, AgentError> {
    let (health, health_reason, devices) = health(runtime);
    let capabilities = capabilities(runtime);
    let enrollment_token = token_file
        .map(std::fs::read_to_string)
        .transpose()
        .map_err(|error| AgentError::Config(error.to_string()))?
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(AgentMessage {
        message: Some(agent_message::Message::Hello(
            scavenger_protocol::control::AgentHello {
                agent_id: agent_id.to_string(),
                devices,
                health,
                health_reason,
                enrollment_token,
                capabilities: Some(capabilities),
            },
        )),
    })
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
                health: current_health,
                health_reason: current_reason,
            })),
        };
        if sender.send(heartbeat).await.is_err() {
            return;
        }
    }
}
