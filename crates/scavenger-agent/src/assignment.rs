use std::path::PathBuf;

use scavenger_core::{TaskPolicy, TaskSpec};
use scavenger_protocol::control::TaskAssignment;

use crate::agent::AgentError;
use crate::runner::RunnerError;

pub(crate) fn assignment_to_spec(assignment: &TaskAssignment) -> Result<TaskSpec, AgentError> {
    if assignment.task_id.is_empty()
        || assignment.device_uuid.is_empty()
        || assignment.program.is_empty()
    {
        return Err(AgentError::Task(RunnerError::InvalidTaskId(
            assignment.task_id.clone(),
        )));
    }
    Ok(TaskSpec {
        task_id: assignment.task_id.clone(),
        lease_epoch: assignment.lease_epoch,
        device_uuid: assignment.device_uuid.clone(),
        program: assignment.program.clone(),
        args: assignment.args.clone(),
        env: assignment
            .env
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        workdir: non_empty_path(&assignment.workdir),
        output_path: non_empty_path(&assignment.output_path),
        policy: TaskPolicy::Stateless,
    })
}

pub(crate) fn spec_device(spec: &TaskSpec) -> scavenger_core::GpuDeviceId {
    scavenger_core::GpuDeviceId {
        uuid: spec.device_uuid.clone(),
    }
}

fn non_empty_path(value: &str) -> Option<PathBuf> {
    (!value.is_empty()).then(|| PathBuf::from(value))
}
