use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use scavenger_core::{GpuProbe, ProbeError};
use scavenger_protocol::control::{AgentHealth, Device, DeviceState};

use crate::probe::NvmlProbe;

const MAX_TRANSIENT_FAILURES: u32 = 3;

pub struct ProbeRuntime {
    pub probe: Option<Arc<NvmlProbe>>,
    pub devices: Vec<Device>,
    pub health: i32,
    pub health_reason: String,
    transient_failures: u32,
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
            transient_failures: 0,
        },
        Err(error) => ProbeRuntime {
            probe: None,
            devices: Vec::new(),
            health: AgentHealth::AgentQuarantined as i32,
            health_reason: error.to_string(),
            transient_failures: 0,
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
        state.transient_failures = 0;
    }
}

pub fn refresh_probe(
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
            set_healthy(runtime, devices);
            health_ok.store(true, Ordering::Release);
            (states, AgentHealth::AgentHealthy as i32, String::new())
        }
        Err(error) => handle_probe_error(runtime, health_ok, error),
    }
}

fn handle_probe_error(
    runtime: &SharedProbeRuntime,
    health_ok: &Arc<AtomicBool>,
    error: ProbeError,
) -> (Vec<DeviceState>, i32, String) {
    let reason = error.to_string();
    if !matches!(error, ProbeError::Transient(_)) {
        set_quarantined(runtime, reason.clone());
        health_ok.store(false, Ordering::Release);
        return (Vec::new(), AgentHealth::AgentQuarantined as i32, reason);
    }
    let failures = increment_transient_failures(runtime, reason.clone());
    if failures >= MAX_TRANSIENT_FAILURES {
        set_quarantined(runtime, reason.clone());
        health_ok.store(false, Ordering::Release);
        return (Vec::new(), AgentHealth::AgentQuarantined as i32, reason);
    }
    health_ok.store(false, Ordering::Release);
    set_degraded(runtime, reason.clone());
    (Vec::new(), AgentHealth::AgentDegraded as i32, reason)
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
                state.transient_failures = 0;
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

fn set_healthy(runtime: &SharedProbeRuntime, devices: Vec<Device>) {
    if let Ok(mut state) = runtime.lock() {
        state.devices = devices;
        state.health = AgentHealth::AgentHealthy as i32;
        state.health_reason.clear();
        state.transient_failures = 0;
    }
}

fn set_degraded(runtime: &SharedProbeRuntime, reason: String) {
    if let Ok(mut state) = runtime.lock() {
        state.health = AgentHealth::AgentDegraded as i32;
        state.health_reason = reason;
    }
}

fn increment_transient_failures(runtime: &SharedProbeRuntime, reason: String) -> u32 {
    runtime
        .lock()
        .map(|mut state| {
            state.transient_failures = state.transient_failures.saturating_add(1);
            state.health_reason = reason;
            state.transient_failures
        })
        .unwrap_or(MAX_TRANSIENT_FAILURES)
}

fn collect_device_states(probe: &NvmlProbe) -> Result<(Vec<Device>, Vec<DeviceState>), ProbeError> {
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
