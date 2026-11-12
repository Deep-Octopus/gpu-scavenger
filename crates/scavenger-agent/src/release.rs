use std::time::Duration;

use scavenger_core::{
    next_release_sample_count, release_verified, GpuProbe, ReleaseObservation, TaskHandle, TaskSpec,
};

use crate::agent::AgentError;
use crate::assignment::spec_device;
use crate::probe::NvmlProbe;
use crate::runner::{RunnerError, SystemdScopeRunner};

const RELEASE_MEMORY_TOLERANCE_BYTES: u64 = 64 * 1024 * 1024;
const RELEASE_REQUIRED_SAMPLES: u32 = 2;
const RELEASE_MAX_POLLS: u32 = 40;

pub(crate) fn wait_for_scope_empty(
    runner: &SystemdScopeRunner,
    handle: &TaskHandle,
) -> Result<(), AgentError> {
    for _ in 0..RELEASE_MAX_POLLS {
        if runner.is_empty(handle)? {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(AgentError::Task(RunnerError::CommandFailed {
        command: "release verification".to_string(),
        stderr: "task cgroup remained active after disconnect".to_string(),
    }))
}

pub(crate) fn wait_for_release(
    runner: &SystemdScopeRunner,
    handle: &TaskHandle,
    probe: &NvmlProbe,
    spec: &TaskSpec,
    cgroup_id: u64,
    baseline_free_memory_bytes: u64,
) -> Result<(), AgentError> {
    let mut ready_samples = 0;
    for _ in 0..RELEASE_MAX_POLLS {
        let snapshot = probe.query_snapshot(&spec_device(spec))?;
        let owned_process_count = snapshot
            .processes
            .iter()
            .filter(|process| process.identity.cgroup_id == Some(cgroup_id))
            .count() as u32;
        let observation = ReleaseObservation {
            cgroup_empty: runner.is_empty(handle)?,
            owned_process_count,
            free_memory_bytes: snapshot.free_memory_bytes,
            baseline_free_memory_bytes,
        };
        ready_samples =
            next_release_sample_count(ready_samples, &observation, RELEASE_MEMORY_TOLERANCE_BYTES);
        if release_verified(ready_samples, RELEASE_REQUIRED_SAMPLES) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(AgentError::Task(RunnerError::CommandFailed {
        command: "release verification".to_string(),
        stderr: "task cgroup or GPU process remained active".to_string(),
    }))
}

pub(crate) fn wait_for_cgroup_id(
    runner: &SystemdScopeRunner,
    handle: &TaskHandle,
) -> Result<u64, AgentError> {
    let mut last_error = None;
    for _ in 0..20 {
        match runner.cgroup_id(handle) {
            Ok(Some(cgroup_id)) => return Ok(cgroup_id),
            Ok(None) => {}
            Err(error) => last_error = Some(error),
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if runner.is_empty(handle)? {
        return Ok(0);
    }
    if let Some(error) = last_error {
        return Err(AgentError::Task(error));
    }
    Err(AgentError::Task(RunnerError::CommandFailed {
        command: "systemctl show ControlGroup".to_string(),
        stderr: "task cgroup was not ready after 1 second".to_string(),
    }))
}
