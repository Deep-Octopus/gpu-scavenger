use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskState {
    Queued,
    Leased,
    Running,
    Stopping,
    Succeeded,
    Failed,
    Requeued,
    Quarantined,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskEvent {
    LeaseGranted,
    Started,
    StopRequested,
    ReleaseVerified,
    TaskFailed,
    LeaseExpired,
    ProbeFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeState {
    Ready,
    Degraded,
    Quarantined,
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeEvent {
    Connected,
    ProbeHealthy,
    ProbeTransientFailure,
    ProbeBoundaryFailure,
    ConnectionLost,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TransitionError {
    #[error("invalid task transition from {state:?} with {event:?}")]
    Invalid { state: TaskState, event: TaskEvent },
}

pub fn apply_task_event(state: TaskState, event: TaskEvent) -> Result<TaskState, TransitionError> {
    let next = match (state, event) {
        (TaskState::Queued, TaskEvent::LeaseGranted) => TaskState::Leased,
        (TaskState::Leased, TaskEvent::Started) => TaskState::Running,
        (TaskState::Running, TaskEvent::StopRequested) => TaskState::Stopping,
        (TaskState::Stopping, TaskEvent::ReleaseVerified) => TaskState::Requeued,
        (TaskState::Running, TaskEvent::ReleaseVerified) => TaskState::Succeeded,
        (TaskState::Running, TaskEvent::TaskFailed) => TaskState::Failed,
        (TaskState::Leased, TaskEvent::LeaseExpired) => TaskState::Requeued,
        (TaskState::Running, TaskEvent::ProbeFailure)
        | (TaskState::Stopping, TaskEvent::ProbeFailure) => TaskState::Quarantined,
        (current, event) => {
            return Err(TransitionError::Invalid {
                state: current,
                event,
            });
        }
    };
    Ok(next)
}

pub fn apply_node_event(state: NodeState, event: NodeEvent) -> NodeState {
    match (state, event) {
        (NodeState::Disconnected, NodeEvent::Connected) => NodeState::Quarantined,
        (_, NodeEvent::ConnectionLost) => NodeState::Disconnected,
        (NodeState::Quarantined, NodeEvent::ProbeHealthy)
        | (NodeState::Degraded, NodeEvent::ProbeHealthy)
        | (NodeState::Ready, NodeEvent::ProbeHealthy) => NodeState::Ready,
        (NodeState::Ready, NodeEvent::ProbeTransientFailure)
        | (NodeState::Degraded, NodeEvent::ProbeTransientFailure) => NodeState::Degraded,
        (_, NodeEvent::ProbeBoundaryFailure) => NodeState::Quarantined,
        (current, NodeEvent::Connected) => current,
        (NodeState::Quarantined, NodeEvent::ProbeTransientFailure) => NodeState::Quarantined,
        (NodeState::Disconnected, NodeEvent::ProbeTransientFailure) => NodeState::Quarantined,
        (NodeState::Disconnected, NodeEvent::ProbeHealthy) => NodeState::Ready,
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_node_event, apply_task_event, NodeEvent, NodeState, TaskEvent, TaskState};

    #[test]
    fn task_lifecycle_is_explicit() {
        let events = [
            TaskEvent::LeaseGranted,
            TaskEvent::Started,
            TaskEvent::ReleaseVerified,
        ];
        let mut state = TaskState::Queued;
        for event in events {
            state = apply_task_event(state, event).unwrap_or(TaskState::Failed);
        }
        assert_eq!(state, TaskState::Succeeded);
    }

    #[test]
    fn invalid_transition_is_rejected() {
        assert!(apply_task_event(TaskState::Queued, TaskEvent::Started).is_err());
    }

    #[test]
    fn node_state_table_fails_closed_on_connection_and_boundary_errors() {
        let cases = [
            (
                NodeState::Ready,
                NodeEvent::ProbeTransientFailure,
                NodeState::Degraded,
            ),
            (
                NodeState::Degraded,
                NodeEvent::ProbeBoundaryFailure,
                NodeState::Quarantined,
            ),
            (
                NodeState::Quarantined,
                NodeEvent::ProbeTransientFailure,
                NodeState::Quarantined,
            ),
            (
                NodeState::Ready,
                NodeEvent::ConnectionLost,
                NodeState::Disconnected,
            ),
            (
                NodeState::Disconnected,
                NodeEvent::Connected,
                NodeState::Quarantined,
            ),
            (
                NodeState::Quarantined,
                NodeEvent::ProbeHealthy,
                NodeState::Ready,
            ),
        ];
        for (state, event, expected) in cases {
            assert_eq!(apply_node_event(state, event), expected);
        }
    }
}
