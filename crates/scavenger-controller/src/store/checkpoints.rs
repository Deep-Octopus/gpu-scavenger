use rusqlite::OptionalExtension;
use scavenger_protocol::control::CheckpointAck;

use super::{unix_ms, StoreError, TaskStore};

impl TaskStore {
    pub fn record_checkpoint(&self, checkpoint: &CheckpointAck) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        let transaction = connection.unchecked_transaction()?;
        if let Some(existing) = transaction
            .query_row(
                "SELECT checkpoint_path, size_bytes, digest FROM task_checkpoints
                 WHERE task_id = ?1 AND lease_epoch = ?2",
                rusqlite::params![checkpoint.task_id, checkpoint.lease_epoch],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
        {
            if existing.0 == checkpoint.checkpoint_path
                && existing.1 == checkpoint.size_bytes
                && existing.2 == checkpoint.digest
            {
                transaction.commit()?;
                return Ok(());
            }
            return Err(StoreError::CheckpointConflict(checkpoint.task_id.clone()));
        }
        let owner = transaction
            .query_row(
                "SELECT agent_id FROM tasks WHERE task_id = ?1 AND lease_epoch = ?2",
                rusqlite::params![checkpoint.task_id, checkpoint.lease_epoch],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if owner.as_deref() != Some(checkpoint.agent_id.as_str()) {
            return Err(StoreError::StaleCheckpoint {
                task_id: checkpoint.task_id.clone(),
                lease_epoch: checkpoint.lease_epoch,
            });
        }
        transaction.execute(
            "INSERT INTO task_checkpoints
             (event_id, task_id, lease_epoch, agent_id, checkpoint_path, size_bytes, digest, committed_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                checkpoint.event_id,
                checkpoint.task_id,
                checkpoint.lease_epoch,
                checkpoint.agent_id,
                checkpoint.checkpoint_path,
                checkpoint.size_bytes,
                checkpoint.digest,
                unix_ms()
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }
}
