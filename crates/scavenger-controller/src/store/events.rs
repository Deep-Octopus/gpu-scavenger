use scavenger_protocol::control::{TaskEvent, TaskEventKind};

use super::{unix_ms, StoreError, TaskStore};

impl TaskStore {
    pub fn record_event(&self, event: &TaskEvent) -> Result<(), StoreError> {
        let (status, clear_agent) = match TaskEventKind::try_from(event.kind) {
            Ok(TaskEventKind::TaskEventStarted) => (Some("running"), false),
            Ok(TaskEventKind::TaskEventSucceeded) => (Some("succeeded"), true),
            Ok(TaskEventKind::TaskEventFailed) => (Some("queued"), true),
            Ok(TaskEventKind::TaskEventStopped) => (Some("queued"), true),
            Ok(TaskEventKind::TaskEventReleaseVerified) => (None, false),
            Err(_) => (None, false),
        };
        let event_id = event_id(event);
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        let transaction = connection.unchecked_transaction()?;
        let inserted = transaction.execute(
            "INSERT OR IGNORE INTO task_events
             (event_id, task_id, lease_epoch, kind, message, output_path, received_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                event_id,
                event.task_id,
                event.lease_epoch,
                event.kind,
                event.message,
                event.output_path,
                unix_ms()
            ],
        )?;
        if inserted == 0 || status.is_none() {
            transaction.commit()?;
            return Ok(());
        }
        if matches!(
            TaskEventKind::try_from(event.kind),
            Ok(TaskEventKind::TaskEventSucceeded)
        ) && !event.output_path.is_empty()
            && !result_exists(&transaction, event)?
        {
            return Err(StoreError::ResultMissing {
                task_id: event.task_id.clone(),
                lease_epoch: event.lease_epoch,
            });
        }
        let now = unix_ms();
        let status = status.unwrap_or("queued");
        if clear_agent {
            transaction.execute(
                "UPDATE tasks SET status = ?1, agent_id = NULL, lease_expires_ms = 0,
                 updated_at_ms = ?2 WHERE task_id = ?3 AND lease_epoch = ?4",
                rusqlite::params![status, now, event.task_id, event.lease_epoch],
            )?;
        } else {
            transaction.execute(
                "UPDATE tasks SET status = ?1, updated_at_ms = ?2
                 WHERE task_id = ?3 AND lease_epoch = ?4",
                rusqlite::params![status, now, event.task_id, event.lease_epoch],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }
}

fn event_id(event: &TaskEvent) -> String {
    if event.event_id.is_empty() {
        format!(
            "task:{}:{}:{}",
            event.task_id, event.lease_epoch, event.kind
        )
    } else {
        event.event_id.clone()
    }
}

fn result_exists(
    transaction: &rusqlite::Transaction<'_>,
    event: &TaskEvent,
) -> Result<bool, StoreError> {
    let exists = transaction.query_row(
        "SELECT 1 FROM task_results WHERE task_id = ?1 AND lease_epoch = ?2",
        rusqlite::params![event.task_id, event.lease_epoch],
        |_| Ok(()),
    );
    match exists {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(StoreError::Sqlite(error)),
    }
}
