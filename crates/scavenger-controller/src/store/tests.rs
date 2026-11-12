use super::TaskStore;
use scavenger_protocol::control::{ResultCommit, TaskEvent, TaskEventKind};

#[test]
fn queued_task_is_leased_and_requeued_after_stop() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::temp_dir().join(format!(
        "gpu-scavenger-store-{}-{}.sqlite3",
        std::process::id(),
        super::unix_ms()
    ));
    let store = TaskStore::open(&path)?;
    let args = vec!["--smoke".to_string()];
    store.enqueue("task-1", "GPU-test", "/bin/true", &args, None, None)?;
    let leased = store
        .lease_next("agent-1", "GPU-test", 60_000)?
        .ok_or("task was not leased")?;
    assert_eq!(leased.lease_epoch, 1);
    assert_eq!(leased.status, "leased");

    store.record_event(&TaskEvent {
        agent_id: "agent-1".to_string(),
        task_id: "task-1".to_string(),
        lease_epoch: 1,
        kind: TaskEventKind::TaskEventStarted as i32,
        message: String::new(),
        output_path: String::new(),
        event_id: "task-1-started".to_string(),
        command_seq: 1,
    })?;
    store.record_event(&TaskEvent {
        agent_id: "agent-1".to_string(),
        task_id: "task-1".to_string(),
        lease_epoch: 1,
        kind: TaskEventKind::TaskEventStopped as i32,
        message: String::new(),
        output_path: String::new(),
        event_id: "task-1-stopped".to_string(),
        command_seq: 1,
    })?;
    store.record_event(&TaskEvent {
        agent_id: "agent-1".to_string(),
        task_id: "task-1".to_string(),
        lease_epoch: 1,
        kind: TaskEventKind::TaskEventReleaseVerified as i32,
        message: String::new(),
        output_path: String::new(),
        event_id: "task-1-released".to_string(),
        command_seq: 1,
    })?;
    let listed = store.list()?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].status, "queued");
    let _ = std::fs::remove_file(path);
    Ok(())
}

#[test]
fn result_commit_is_idempotent_and_rejects_conflicts() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::temp_dir().join(format!(
        "gpu-scavenger-result-{}-{}.sqlite3",
        std::process::id(),
        super::unix_ms()
    ));
    let store = TaskStore::open(&path)?;
    store.enqueue(
        "task-result",
        "GPU-test",
        "/bin/true",
        &[],
        None,
        Some("/tmp/output.bin"),
    )?;
    let leased = store
        .lease_next("agent-1", "GPU-test", 60_000)?
        .ok_or("task was not leased")?;
    let commit = ResultCommit {
        event_id: "result-task-result-1".to_string(),
        agent_id: "agent-1".to_string(),
        task_id: leased.task_id.clone(),
        lease_epoch: leased.lease_epoch,
        output_path: "/tmp/output.bin".to_string(),
        output_size_bytes: 10,
        digest: "".to_string(),
    };
    store.commit_result(&commit)?;
    store.commit_result(&commit)?;
    let conflict = ResultCommit {
        output_size_bytes: 11,
        ..commit.clone()
    };
    assert!(store.commit_result(&conflict).is_err());
    let success = TaskEvent {
        agent_id: "agent-1".to_string(),
        task_id: leased.task_id,
        lease_epoch: leased.lease_epoch,
        kind: TaskEventKind::TaskEventSucceeded as i32,
        message: "done".to_string(),
        output_path: "/tmp/output.bin".to_string(),
        event_id: "task-result-succeeded".to_string(),
        command_seq: 1,
    };
    store.record_event(&success)?;
    store.record_event(&success)?;
    assert_eq!(store.list()?[0].status, "succeeded");
    let _ = std::fs::remove_file(path);
    Ok(())
}

#[test]
fn reconnect_requeues_only_the_agent_owned_tasks() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::temp_dir().join(format!(
        "gpu-scavenger-requeue-{}-{}.sqlite3",
        std::process::id(),
        super::unix_ms()
    ));
    let store = TaskStore::open(&path)?;
    store.enqueue("task-a", "GPU-a", "/bin/true", &[], None, None)?;
    store.enqueue("task-b", "GPU-b", "/bin/true", &[], None, None)?;
    store.lease_next("agent-a", "GPU-a", 60_000)?;
    store.lease_next("agent-b", "GPU-b", 60_000)?;
    store.requeue_agent_tasks("agent-a")?;
    let tasks = store.list()?;
    assert_eq!(tasks[0].status, "queued");
    assert_eq!(tasks[1].status, "leased");
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    Ok(())
}
