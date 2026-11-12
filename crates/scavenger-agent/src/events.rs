use scavenger_protocol::control::{
    agent_message, AgentMessage, ClaimEvent, ResultCommit, TaskAssignment, TaskEvent, TaskEventKind,
};
use tokio::sync::mpsc;

use crate::agent::AgentError;

pub(crate) fn send_claim_event_blocking(
    sender: &mpsc::Sender<AgentMessage>,
    agent_id: &str,
    device_uuid: &str,
    active: bool,
    reason: &str,
) -> Result<(), AgentError> {
    sender
        .blocking_send(AgentMessage {
            message: Some(agent_message::Message::Claim(ClaimEvent {
                agent_id: agent_id.to_string(),
                device_uuid: device_uuid.to_string(),
                active,
                reason: reason.to_string(),
            })),
        })
        .map_err(|_| AgentError::ChannelClosed)
}

pub(crate) async fn send_task_event(
    sender: &mpsc::Sender<AgentMessage>,
    agent_id: &str,
    assignment: &TaskAssignment,
    kind: TaskEventKind,
    message: &str,
) -> Result<(), AgentError> {
    sender
        .send(task_event_message(agent_id, assignment, kind, message))
        .await
        .map_err(|_| AgentError::ChannelClosed)
}

pub(crate) fn send_task_event_blocking(
    sender: &mpsc::Sender<AgentMessage>,
    agent_id: &str,
    assignment: &TaskAssignment,
    kind: TaskEventKind,
    message: &str,
) -> Result<(), AgentError> {
    sender
        .blocking_send(task_event_message(agent_id, assignment, kind, message))
        .map_err(|_| AgentError::ChannelClosed)
}

pub(crate) fn send_result_commit_blocking(
    sender: &mpsc::Sender<AgentMessage>,
    agent_id: &str,
    assignment: &TaskAssignment,
    output_size_bytes: u64,
    digest: &str,
) -> Result<(), AgentError> {
    let event_id = format!("result:{}:{}", assignment.task_id, assignment.lease_epoch);
    sender
        .blocking_send(AgentMessage {
            message: Some(agent_message::Message::ResultCommit(ResultCommit {
                event_id,
                agent_id: agent_id.to_string(),
                task_id: assignment.task_id.clone(),
                lease_epoch: assignment.lease_epoch,
                output_path: assignment.output_path.clone(),
                output_size_bytes,
                digest: digest.to_string(),
            })),
        })
        .map_err(|_| AgentError::ChannelClosed)
}

fn task_event_message(
    agent_id: &str,
    assignment: &TaskAssignment,
    kind: TaskEventKind,
    message: &str,
) -> AgentMessage {
    AgentMessage {
        message: Some(agent_message::Message::TaskEvent(TaskEvent {
            agent_id: agent_id.to_string(),
            task_id: assignment.task_id.clone(),
            lease_epoch: assignment.lease_epoch,
            kind: kind as i32,
            message: message.to_string(),
            output_path: assignment.output_path.clone(),
            event_id: format!(
                "task:{}:{}:{}",
                assignment.task_id, assignment.lease_epoch, kind as i32
            ),
        })),
    }
}
