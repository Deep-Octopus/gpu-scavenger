use std::collections::BTreeMap;
use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GpuDeviceId {
    pub uuid: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuProcessKind {
    Compute,
    Graphics,
    Mps,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub start_time_ticks: u64,
    pub uid: u32,
    pub cgroup_id: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GpuProcessInfo {
    pub identity: ProcessIdentity,
    pub kind: GpuProcessKind,
    pub used_memory_bytes: u64,
    pub gpu_instance_id: Option<u32>,
    pub compute_instance_id: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeHealth {
    Healthy,
    PermissionDenied,
    DriverUnavailable,
    NotSupported,
    TransientFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GpuSnapshot {
    pub device: GpuDeviceId,
    pub total_memory_bytes: u64,
    pub free_memory_bytes: u64,
    pub utilization_gpu_percent: u32,
    pub processes: Vec<GpuProcessInfo>,
    pub observed_at_monotonic_ms: u64,
    pub health: ProbeHealth,
}

#[derive(Debug, Error)]
pub enum ProbeError {
    #[error("GPU driver unavailable: {0}")]
    DriverUnavailable(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("device is not supported: {0}")]
    NotSupported(String),
    #[error("transient query failure: {0}")]
    Transient(String),
}

pub trait GpuProbe: Send + Sync {
    fn inventory(&self) -> Result<Vec<GpuDeviceId>, ProbeError>;
    fn query_snapshot(&self, device: &GpuDeviceId) -> Result<GpuSnapshot, ProbeError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostDemand {
    None,
    ExplicitClaim {
        reason: String,
        expires_at_ms: u64,
    },
    GuardActive {
        guard_id: String,
        expires_at_ms: Option<u64>,
    },
    ObservedExternal {
        confirmed_samples: u32,
    },
    Unknown {
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskPolicy {
    Stateless,
    Checkpointed { checkpoint_deadline_ms: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvictionDecision {
    KeepRunning,
    StopAcceptingNewWork,
    RequestCheckpoint { deadline_ms: u64 },
    HardStop { reason: String },
    Quarantine { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskSpec {
    pub task_id: String,
    pub lease_epoch: u64,
    pub device_uuid: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub workdir: Option<PathBuf>,
    pub output_path: Option<PathBuf>,
    pub policy: TaskPolicy,
    pub checkpoint_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskHandle {
    pub task_id: String,
    pub unit_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckpointRequest {
    pub task_id: String,
    pub lease_epoch: u64,
    pub deadline_ms: u64,
    pub reason: String,
    pub checkpoint_path: Option<PathBuf>,
}

pub trait TaskRunner: Send {
    type Error;

    fn start(&mut self, spec: &TaskSpec) -> Result<TaskHandle, Self::Error>;
    fn request_checkpoint(
        &mut self,
        handle: &TaskHandle,
        request: &CheckpointRequest,
    ) -> Result<(), Self::Error>;
    fn hard_stop(&mut self, handle: &TaskHandle) -> Result<(), Self::Error>;
    fn is_empty(&self, handle: &TaskHandle) -> Result<bool, Self::Error>;
}
