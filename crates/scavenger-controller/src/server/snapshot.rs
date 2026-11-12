use serde::Serialize;

use super::ControllerState;

#[derive(Debug, Clone, Serialize)]
pub struct ControllerSnapshot {
    pub agents: Vec<AgentSnapshot>,
    pub tasks: Vec<TaskSnapshot>,
    pub metrics: MetricsSnapshot,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentSnapshot {
    pub agent_id: String,
    pub health: String,
    pub reason: String,
    pub claim_active: bool,
    pub busy: bool,
    pub session_id: u64,
    pub devices: Vec<DeviceSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceSnapshot {
    pub uuid: String,
    pub free_memory_bytes: u64,
    pub process_count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskSnapshot {
    pub task_id: String,
    pub status: String,
    pub device_uuid: String,
    pub program: String,
    pub lease_epoch: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct MetricsSnapshot {
    pub total_tasks: u64,
    pub queued_tasks: u64,
    pub leased_tasks: u64,
    pub running_tasks: u64,
    pub succeeded_tasks: u64,
    pub failed_tasks: u64,
    pub requeued_tasks: u64,
    pub quarantined_tasks: u64,
}

pub(super) fn build(state: &ControllerState) -> Result<ControllerSnapshot, String> {
    let tasks = state.store.list().map_err(|error| error.to_string())?;
    let mut metrics = MetricsSnapshot::default();
    let task_snapshots = tasks
        .into_iter()
        .map(|task| {
            metrics.total_tasks = metrics.total_tasks.saturating_add(1);
            increment_status(&mut metrics, &task.status);
            TaskSnapshot {
                task_id: task.task_id,
                status: task.status,
                device_uuid: task.device_uuid,
                program: task.program,
                lease_epoch: task.lease_epoch,
            }
        })
        .collect();
    let agents = state
        .agents
        .lock()
        .map_err(|_| "agent registry lock poisoned".to_string())?
        .iter()
        .map(|(agent_id, agent)| AgentSnapshot {
            agent_id: agent_id.clone(),
            health: health_name(agent),
            reason: agent.health_reason.clone(),
            claim_active: agent.claim_active,
            busy: agent.busy,
            session_id: agent.session_id,
            devices: agent
                .devices
                .iter()
                .map(|device| DeviceSnapshot {
                    uuid: device.uuid.clone(),
                    free_memory_bytes: device.free_memory_bytes,
                    process_count: device.process_count,
                })
                .collect(),
        })
        .collect();
    Ok(ControllerSnapshot {
        agents,
        tasks: task_snapshots,
        metrics,
    })
}

fn increment_status(metrics: &mut MetricsSnapshot, status: &str) {
    match status {
        "queued" => metrics.queued_tasks = metrics.queued_tasks.saturating_add(1),
        "leased" => metrics.leased_tasks = metrics.leased_tasks.saturating_add(1),
        "running" => metrics.running_tasks = metrics.running_tasks.saturating_add(1),
        "succeeded" => metrics.succeeded_tasks = metrics.succeeded_tasks.saturating_add(1),
        "failed" => metrics.failed_tasks = metrics.failed_tasks.saturating_add(1),
        "requeued" => metrics.requeued_tasks = metrics.requeued_tasks.saturating_add(1),
        "quarantined" => metrics.quarantined_tasks = metrics.quarantined_tasks.saturating_add(1),
        _ => {}
    }
}

fn health_name(agent: &super::AgentHandle) -> String {
    if agent.quarantined {
        "quarantined".to_string()
    } else if agent.degraded {
        "degraded".to_string()
    } else {
        "ready".to_string()
    }
}
