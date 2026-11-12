use std::path::PathBuf;

use super::{AgentHandle, ControllerService};
use crate::store::TaskStore;
use scavenger_protocol::control::master_message::Message;
use scavenger_protocol::control::{
    agent_message, AgentHealth, AgentMessage, ClaimEvent, DeviceState, TaskEvent, TaskEventKind,
};
use tokio::sync::mpsc;

fn device(uuid: &str) -> DeviceState {
    DeviceState {
        uuid: uuid.to_string(),
        free_memory_bytes: 80_000,
        process_count: 0,
    }
}

fn test_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "gpu-scavenger-{name}-{}-{}.sqlite3",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0)
    ))
}

#[test]
fn scheduler_round_robins_ready_agents_without_duplicate_leases(
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = test_path("multi-agent");
    let store = TaskStore::open(&path)?;
    store.enqueue("task-a", "GPU-a", "/bin/true", &[], None, None)?;
    store.enqueue("task-b", "GPU-b", "/bin/true", &[], None, None)?;
    let service = ControllerService::new(store.clone());
    let state = service.state.clone();
    let (sender_a, mut receiver_a) = mpsc::channel(32);
    let (sender_b, mut receiver_b) = mpsc::channel(32);
    state
        .register_agent(
            "agent-a".to_string(),
            AgentHandle {
                session_id: 0,
                devices: vec![device("GPU-a")],
                sender: sender_a,
                busy: false,
                claim_active: false,
                quarantined: false,
                degraded: false,
                health_reason: String::new(),
                capabilities: Default::default(),
                next_command_seq: 0,
            },
        )
        .map_err(|error| error.to_string())?;
    state
        .register_agent(
            "agent-b".to_string(),
            AgentHandle {
                session_id: 0,
                devices: vec![device("GPU-b")],
                sender: sender_b,
                busy: false,
                claim_active: false,
                quarantined: false,
                degraded: false,
                health_reason: String::new(),
                capabilities: Default::default(),
                next_command_seq: 0,
            },
        )
        .map_err(|error| error.to_string())?;

    state.schedule_once()?;
    state.schedule_once()?;
    let first = receiver_a.try_recv().map_err(|error| error.to_string())??;
    let second = receiver_b.try_recv().map_err(|error| error.to_string())??;
    assert!(matches!(
        first.message,
        Some(Message::Task(task)) if task.task_id == "task-a"
    ));
    assert!(matches!(
        second.message,
        Some(Message::Task(task)) if task.task_id == "task-b"
    ));
    let listed = store.list()?;
    assert!(listed.iter().all(|task| task.status == "leased"));
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    Ok(())
}

#[test]
fn scheduler_waits_for_release_verified_before_reusing_agent(
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = test_path("release-gate");
    let store = TaskStore::open(&path)?;
    store.enqueue("task-release", "GPU-a", "/bin/true", &[], None, None)?;
    let service = ControllerService::new(store.clone());
    let state = service.state.clone();
    let (sender, _receiver) = mpsc::channel(32);
    state
        .register_agent(
            "agent-a".to_string(),
            AgentHandle {
                session_id: 0,
                devices: vec![device("GPU-a")],
                sender,
                busy: false,
                claim_active: false,
                quarantined: false,
                degraded: false,
                health_reason: String::new(),
                capabilities: Default::default(),
                next_command_seq: 0,
            },
        )
        .map_err(|error| error.to_string())?;
    state.schedule_once()?;
    let stopped = TaskEvent {
        agent_id: "agent-a".to_string(),
        task_id: "task-release".to_string(),
        lease_epoch: 1,
        kind: TaskEventKind::TaskEventStopped as i32,
        message: String::new(),
        output_path: String::new(),
        event_id: "task-release-stopped".to_string(),
        command_seq: 1,
    };
    let session_id = state.session_id("agent-a").ok_or("missing session")?;
    state.handle_message(
        "agent-a",
        session_id,
        AgentMessage {
            message: Some(agent_message::Message::TaskEvent(stopped.clone())),
        },
    );
    assert!(state.select_candidate()?.is_none());
    let released = TaskEvent {
        kind: TaskEventKind::TaskEventReleaseVerified as i32,
        event_id: "task-release-verified".to_string(),
        ..stopped
    };
    state.handle_message(
        "agent-a",
        session_id,
        AgentMessage {
            message: Some(agent_message::Message::TaskEvent(released)),
        },
    );
    assert!(state.select_candidate()?.is_some());
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    Ok(())
}

#[test]
fn scheduler_skips_quarantined_agents() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = test_path("quarantine-gate");
    let store = TaskStore::open(&path)?;
    store.enqueue("task-quarantine", "GPU-a", "/bin/true", &[], None, None)?;
    let service = ControllerService::new(store.clone());
    let state = service.state.clone();
    let (sender, mut receiver) = mpsc::channel(32);
    state
        .register_agent(
            "agent-a".to_string(),
            AgentHandle {
                session_id: 0,
                devices: vec![device("GPU-a")],
                sender,
                busy: false,
                claim_active: false,
                quarantined: true,
                degraded: false,
                health_reason: String::new(),
                capabilities: Default::default(),
                next_command_seq: 0,
            },
        )
        .map_err(|error| error.to_string())?;
    state.schedule_once()?;
    assert!(receiver.try_recv().is_err());
    assert_eq!(store.list()?[0].status, "queued");
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    Ok(())
}

#[test]
fn stale_session_messages_do_not_mutate_replaced_agent(
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = test_path("stale-session");
    let store = TaskStore::open(&path)?;
    let service = ControllerService::new(store);
    let state = service.state.clone();
    let (sender_a, _receiver_a) = mpsc::channel(32);
    let session_a = state
        .register_agent(
            "agent-a".to_string(),
            AgentHandle {
                session_id: 0,
                devices: vec![device("GPU-a")],
                sender: sender_a,
                busy: false,
                claim_active: false,
                quarantined: false,
                degraded: false,
                health_reason: String::new(),
                capabilities: Default::default(),
                next_command_seq: 0,
            },
        )
        .map_err(|error| error.to_string())?;
    let (sender_b, _receiver_b) = mpsc::channel(32);
    let session_b = state
        .register_agent(
            "agent-a".to_string(),
            AgentHandle {
                session_id: 0,
                devices: vec![device("GPU-a")],
                sender: sender_b,
                busy: false,
                claim_active: false,
                quarantined: false,
                degraded: false,
                health_reason: String::new(),
                capabilities: Default::default(),
                next_command_seq: 0,
            },
        )
        .map_err(|error| error.to_string())?;
    assert_ne!(session_a, session_b);
    let stale_claim = AgentMessage {
        message: Some(agent_message::Message::Claim(ClaimEvent {
            agent_id: "agent-a".to_string(),
            device_uuid: String::new(),
            active: true,
            reason: "stale".to_string(),
        })),
    };
    state.handle_message("agent-a", session_a, stale_claim);
    assert!(
        !state
            .agents
            .lock()
            .map_err(|_| "agent registry lock poisoned")?
            .get("agent-a")
            .ok_or("agent missing")?
            .claim_active
    );
    let healthy = AgentMessage {
        message: Some(agent_message::Message::Heartbeat(
            scavenger_protocol::control::AgentHeartbeat {
                agent_id: "agent-a".to_string(),
                monotonic_ms: 0,
                devices: vec![device("GPU-a")],
                health: AgentHealth::AgentHealthy as i32,
                health_reason: String::new(),
            },
        )),
    };
    state.handle_message("agent-a", session_b, healthy);
    assert!(
        !state
            .agents
            .lock()
            .map_err(|_| "agent registry lock poisoned")?
            .get("agent-a")
            .ok_or("agent missing")?
            .quarantined
    );
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    Ok(())
}
