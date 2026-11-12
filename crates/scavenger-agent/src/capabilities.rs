use std::path::Path;

use scavenger_protocol::control::AgentCapabilities;

pub fn detect(probe_available: bool, probe_reason: Option<&str>) -> AgentCapabilities {
    let operating_system = std::env::consts::OS.to_string();
    let architecture = std::env::consts::ARCH.to_string();
    let cgroup_v2 = Path::new("/sys/fs/cgroup/cgroup.controllers").exists();
    let systemd = Path::new("/run/systemd/system").exists();
    let linux = operating_system == "linux";
    let isolation = if linux && cgroup_v2 && systemd {
        "systemd-cgroup-v2"
    } else if linux && cgroup_v2 {
        "cgroup-v2-without-systemd"
    } else {
        "unsupported"
    };
    let gpu_backend = if probe_available {
        "nvidia-nvml"
    } else {
        "nvidia-nvml-unavailable"
    };
    let schedulable = linux && probe_available && isolation == "systemd-cgroup-v2";
    let reason = capability_reason(schedulable, probe_reason, linux, cgroup_v2, systemd);
    AgentCapabilities {
        operating_system,
        architecture,
        gpu_backend: gpu_backend.to_string(),
        isolation: isolation.to_string(),
        checkpoint: if schedulable {
            "sigusr1-file-ack"
        } else {
            "unsupported"
        }
        .to_string(),
        mig: if probe_available {
            "observed-only"
        } else {
            "unavailable"
        }
        .to_string(),
        schedulable,
        reason,
    }
}

fn capability_reason(
    schedulable: bool,
    probe_reason: Option<&str>,
    linux: bool,
    cgroup_v2: bool,
    systemd: bool,
) -> String {
    if schedulable {
        return "Linux/NVIDIA systemd scope boundary is available".to_string();
    }
    if let Some(reason) = probe_reason.filter(|value| !value.is_empty()) {
        return reason.to_string();
    }
    if !linux {
        return "this agent build only enables Linux process containment".to_string();
    }
    if !cgroup_v2 {
        return "cgroup v2 is unavailable".to_string();
    }
    if !systemd {
        return "systemd scope runner is unavailable".to_string();
    }
    "platform capability check failed".to_string()
}
