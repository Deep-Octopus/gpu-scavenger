use rusqlite::OptionalExtension;
use scavenger_protocol::control::ResultCommit;

use super::{unix_ms, StoreError, TaskStore};

impl TaskStore {
    pub fn commit_result(&self, commit: &ResultCommit) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        let transaction = connection.unchecked_transaction()?;
        if let Some(existing) = transaction
            .query_row(
                "SELECT output_path, output_size_bytes, digest FROM task_results
                 WHERE task_id = ?1 AND lease_epoch = ?2",
                rusqlite::params![commit.task_id, commit.lease_epoch],
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
            if existing.0 == commit.output_path
                && existing.1 == commit.output_size_bytes
                && existing.2 == commit.digest
            {
                transaction.commit()?;
                return Ok(());
            }
            return Err(StoreError::ResultConflict(commit.task_id.clone()));
        }
        let owner = transaction
            .query_row(
                "SELECT agent_id FROM tasks WHERE task_id = ?1 AND lease_epoch = ?2",
                rusqlite::params![commit.task_id, commit.lease_epoch],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if owner.as_deref() != Some(commit.agent_id.as_str()) {
            return Err(StoreError::StaleResult {
                task_id: commit.task_id.clone(),
                lease_epoch: commit.lease_epoch,
            });
        }
        transaction.execute(
            "INSERT INTO task_results
             (event_id, task_id, lease_epoch, agent_id, output_path, output_size_bytes, digest, committed_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                commit.event_id,
                commit.task_id,
                commit.lease_epoch,
                commit.agent_id,
                commit.output_path,
                commit.output_size_bytes,
                commit.digest,
                unix_ms()
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }
}
