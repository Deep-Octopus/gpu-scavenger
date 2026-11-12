use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::sync::OnceLock;
use std::time::Instant;

use nvml_wrapper::enums::device::UsedGpuMemory;
use nvml_wrapper::error::NvmlError;
use nvml_wrapper::{Device, Nvml};
use scavenger_core::{
    GpuDeviceId, GpuProbe, GpuProcessInfo, GpuProcessKind, GpuSnapshot, ProbeError, ProbeHealth,
    ProcessIdentity,
};

pub struct NvmlProbe {
    nvml: Nvml,
}

impl NvmlProbe {
    pub fn new() -> Result<Self, ProbeError> {
        Nvml::init()
            .map(|nvml| Self { nvml })
            .map_err(map_nvml_error)
    }

    fn read_process_identity(pid: u32) -> Result<Option<ProcessIdentity>, ProbeError> {
        let stat_path = format!("/proc/{pid}/stat");
        let stat = match fs::read_to_string(&stat_path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(map_io_error(error)),
        };
        let (_, fields) = stat
            .rsplit_once(") ")
            .ok_or_else(|| ProbeError::Transient(format!("invalid process stat for {pid}")))?;
        let parts: Vec<&str> = fields.split_whitespace().collect();
        let start_time_ticks = parts
            .get(19)
            .ok_or_else(|| ProbeError::Transient(format!("missing start time for {pid}")))?
            .parse::<u64>()
            .map_err(|error| ProbeError::Transient(error.to_string()))?;

        let status_path = format!("/proc/{pid}/status");
        let status = fs::read_to_string(status_path).map_err(map_io_error)?;
        let uid = status
            .lines()
            .find_map(|line| {
                line.strip_prefix("Uid:")
                    .and_then(|value| value.split_whitespace().next())
            })
            .ok_or_else(|| ProbeError::Transient(format!("missing uid for {pid}")))?
            .parse::<u32>()
            .map_err(|error| ProbeError::Transient(error.to_string()))?;

        let cgroup_id = read_cgroup_id(pid)?;
        Ok(Some(ProcessIdentity {
            pid,
            start_time_ticks,
            uid,
            cgroup_id,
        }))
    }

    fn add_process(
        map: &mut BTreeMap<u32, GpuProcessInfo>,
        pid: u32,
        kind: GpuProcessKind,
        used_memory_bytes: u64,
        gpu_instance_id: Option<u32>,
        compute_instance_id: Option<u32>,
    ) -> Result<(), ProbeError> {
        let Some(identity) = Self::read_process_identity(pid)? else {
            return Ok(());
        };
        let entry = map.entry(pid).or_insert_with(|| GpuProcessInfo {
            identity,
            kind,
            used_memory_bytes,
            gpu_instance_id,
            compute_instance_id,
        });
        entry.kind = merge_kind(entry.kind, kind);
        entry.used_memory_bytes = entry.used_memory_bytes.max(used_memory_bytes);
        entry.gpu_instance_id = entry.gpu_instance_id.or(gpu_instance_id);
        entry.compute_instance_id = entry.compute_instance_id.or(compute_instance_id);
        Ok(())
    }

    fn collect_processes(device: &Device<'_>) -> Result<Vec<GpuProcessInfo>, ProbeError> {
        let mut processes = BTreeMap::new();
        let compute = device.running_compute_processes().map_err(map_nvml_error)?;
        for process in compute {
            Self::add_process(
                &mut processes,
                process.pid,
                GpuProcessKind::Compute,
                used_memory(process.used_gpu_memory),
                process.gpu_instance_id,
                process.compute_instance_id,
            )?;
        }
        let graphics = device
            .running_graphics_processes()
            .map_err(map_nvml_error)?;
        for process in graphics {
            Self::add_process(
                &mut processes,
                process.pid,
                GpuProcessKind::Graphics,
                used_memory(process.used_gpu_memory),
                process.gpu_instance_id,
                process.compute_instance_id,
            )?;
        }
        let mps = match device.mps_running_compute_processes() {
            Ok(processes) => processes,
            Err(NvmlError::NotSupported) => Vec::new(),
            Err(error) => return Err(map_nvml_error(error)),
        };
        for process in mps {
            Self::add_process(
                &mut processes,
                process.pid,
                GpuProcessKind::Mps,
                used_memory(process.used_gpu_memory),
                process.gpu_instance_id,
                process.compute_instance_id,
            )?;
        }
        Ok(processes.into_values().collect())
    }
}

impl GpuProbe for NvmlProbe {
    fn inventory(&self) -> Result<Vec<GpuDeviceId>, ProbeError> {
        let count = self.nvml.device_count().map_err(map_nvml_error)?;
        (0..count)
            .map(|index| {
                self.nvml
                    .device_by_index(index)
                    .and_then(|device| device.uuid())
                    .map(|uuid| GpuDeviceId { uuid })
                    .map_err(map_nvml_error)
            })
            .collect()
    }

    fn query_snapshot(&self, device_id: &GpuDeviceId) -> Result<GpuSnapshot, ProbeError> {
        let device = self
            .nvml
            .device_by_uuid(device_id.uuid.as_str())
            .map_err(map_nvml_error)?;
        let memory = device.memory_info().map_err(map_nvml_error)?;
        let utilization = device.utilization_rates().map_err(map_nvml_error)?;
        let processes = Self::collect_processes(&device)?;
        Ok(GpuSnapshot {
            device: device_id.clone(),
            total_memory_bytes: memory.total,
            free_memory_bytes: memory.free,
            utilization_gpu_percent: utilization.gpu,
            processes,
            observed_at_monotonic_ms: monotonic_ms(),
            health: ProbeHealth::Healthy,
        })
    }
}

fn used_memory(value: UsedGpuMemory) -> u64 {
    match value {
        UsedGpuMemory::Used(bytes) => bytes,
        UsedGpuMemory::Unavailable => 0,
    }
}

fn map_nvml_error(error: NvmlError) -> ProbeError {
    match error {
        NvmlError::NoPermission => ProbeError::PermissionDenied(error.to_string()),
        NvmlError::NotSupported => ProbeError::NotSupported(error.to_string()),
        NvmlError::DriverNotLoaded | NvmlError::Uninitialized | NvmlError::LibraryNotFound => {
            ProbeError::DriverUnavailable(error.to_string())
        }
        other => ProbeError::Transient(other.to_string()),
    }
}

fn map_io_error(error: std::io::Error) -> ProbeError {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        ProbeError::PermissionDenied(error.to_string())
    } else {
        ProbeError::Transient(error.to_string())
    }
}

fn merge_kind(left: GpuProcessKind, right: GpuProcessKind) -> GpuProcessKind {
    match (left, right) {
        (GpuProcessKind::Mps, _) | (_, GpuProcessKind::Mps) => GpuProcessKind::Mps,
        (GpuProcessKind::Compute, _) | (_, GpuProcessKind::Compute) => GpuProcessKind::Compute,
        (GpuProcessKind::Graphics, GpuProcessKind::Graphics) => GpuProcessKind::Graphics,
        _ => GpuProcessKind::Other,
    }
}

fn read_cgroup_id(pid: u32) -> Result<Option<u64>, ProbeError> {
    let content = fs::read_to_string(format!("/proc/{pid}/cgroup")).map_err(map_io_error)?;
    let Some(path) = content.lines().find_map(|line| line.strip_prefix("0::")) else {
        return Ok(None);
    };
    let absolute = format!("/sys/fs/cgroup{path}");
    match fs::metadata(absolute) {
        Ok(metadata) => Ok(Some(metadata.ino())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(map_io_error(error)),
    }
}

fn monotonic_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::map_nvml_error;
    use nvml_wrapper::error::NvmlError;
    use scavenger_core::ProbeError;

    #[test]
    fn maps_boundary_errors_to_safe_probe_states() {
        assert!(matches!(
            map_nvml_error(NvmlError::NoPermission),
            ProbeError::PermissionDenied(_)
        ));
        assert!(matches!(
            map_nvml_error(NvmlError::NotSupported),
            ProbeError::NotSupported(_)
        ));
        assert!(matches!(
            map_nvml_error(NvmlError::DriverNotLoaded),
            ProbeError::DriverUnavailable(_)
        ));
    }
}
