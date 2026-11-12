use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct TaskRecord {
    pub task_id: String,
    pub lease_epoch: u64,
    pub device_uuid: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub workdir: Option<String>,
    pub output_path: Option<String>,
    pub status: String,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("store lock poisoned")]
    LockPoisoned,
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid task: {0}")]
    InvalidTask(String),
    #[error("result commit is missing for {task_id} lease {lease_epoch}")]
    ResultMissing { task_id: String, lease_epoch: u64 },
    #[error("result commit conflicts with an existing commit for task {0}")]
    ResultConflict(String),
    #[error("stale result commit for {task_id} lease {lease_epoch}")]
    StaleResult { task_id: String, lease_epoch: u64 },
    #[error("database path error: {0}")]
    Path(#[from] std::io::Error),
}

#[derive(Clone)]
pub struct TaskStore {
    connection: Arc<Mutex<Connection>>,
}

impl TaskStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(&path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                lease_epoch INTEGER NOT NULL DEFAULT 0,
                device_uuid TEXT NOT NULL,
                program TEXT NOT NULL,
                args_json TEXT NOT NULL,
                env_json TEXT NOT NULL,
                workdir TEXT,
                output_path TEXT,
                status TEXT NOT NULL,
                agent_id TEXT,
                lease_expires_ms INTEGER NOT NULL DEFAULT 0,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at_ms);
            CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(status, lease_expires_ms);
            CREATE TABLE IF NOT EXISTS task_events (
                event_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                lease_epoch INTEGER NOT NULL,
                kind INTEGER NOT NULL,
                message TEXT NOT NULL,
                output_path TEXT NOT NULL,
                received_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS task_results (
                event_id TEXT UNIQUE NOT NULL,
                task_id TEXT NOT NULL,
                lease_epoch INTEGER NOT NULL,
                agent_id TEXT NOT NULL,
                output_path TEXT NOT NULL,
                output_size_bytes INTEGER NOT NULL,
                digest TEXT NOT NULL,
                committed_at_ms INTEGER NOT NULL,
                PRIMARY KEY (task_id, lease_epoch)
            );
            ",
        )?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn enqueue(
        &self,
        task_id: &str,
        device_uuid: &str,
        program: &str,
        args: &[String],
        workdir: Option<&str>,
        output_path: Option<&str>,
    ) -> Result<(), StoreError> {
        if task_id.is_empty() || device_uuid.is_empty() || program.is_empty() {
            return Err(StoreError::InvalidTask(
                "task_id, device_uuid and program are required".to_string(),
            ));
        }
        let args_json = serde_json::to_string(args)?;
        let env_json = serde_json::to_string(&BTreeMap::<String, String>::new())?;
        let now = unix_ms();
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        connection.execute(
            "INSERT INTO tasks
             (task_id, device_uuid, program, args_json, env_json, workdir, output_path,
              status, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?8)",
            params![
                task_id,
                device_uuid,
                program,
                args_json,
                env_json,
                workdir,
                output_path,
                now
            ],
        )?;
        Ok(())
    }

    pub fn lease_next(
        &self,
        agent_id: &str,
        device_uuid: &str,
        lease_duration_ms: u64,
    ) -> Result<Option<TaskRecord>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        let transaction = connection.unchecked_transaction()?;
        let row = transaction
            .query_row(
                "SELECT task_id, lease_epoch, device_uuid, program, args_json, env_json,
                        workdir, output_path, status
                 FROM tasks
                 WHERE status = 'queued' AND device_uuid = ?1
                 ORDER BY created_at_ms
                 LIMIT 1",
                params![device_uuid],
                |row| {
                    Ok(TaskRecord {
                        task_id: row.get(0)?,
                        lease_epoch: row.get::<_, u64>(1)?.saturating_add(1),
                        device_uuid: row.get(2)?,
                        program: row.get(3)?,
                        args: parse_json(row.get::<_, String>(4)?)?,
                        env: parse_json(row.get::<_, String>(5)?)?,
                        workdir: row.get(6)?,
                        output_path: row.get(7)?,
                        status: row.get(8)?,
                    })
                },
            )
            .optional()?;
        let Some(mut task) = row else {
            transaction.commit()?;
            return Ok(None);
        };
        let now = unix_ms();
        transaction.execute(
            "UPDATE tasks
             SET lease_epoch = ?1, status = 'leased', agent_id = ?2,
                 lease_expires_ms = ?3, updated_at_ms = ?4
             WHERE task_id = ?5 AND status = 'queued'",
            params![
                task.lease_epoch,
                agent_id,
                now.saturating_add(lease_duration_ms),
                now,
                task.task_id
            ],
        )?;
        transaction.commit()?;
        task.status = "leased".to_string();
        Ok(Some(task))
    }

    pub fn renew_agent(&self, agent_id: &str, lease_duration_ms: u64) -> Result<(), StoreError> {
        let now = unix_ms();
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        connection.execute(
            "UPDATE tasks SET lease_expires_ms = ?1, updated_at_ms = ?2
             WHERE agent_id = ?3 AND status IN ('leased', 'running')",
            params![now.saturating_add(lease_duration_ms), now, agent_id],
        )?;
        Ok(())
    }

    pub fn requeue_expired(&self) -> Result<(), StoreError> {
        let now = unix_ms();
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        connection.execute(
            "UPDATE tasks SET status = 'queued', agent_id = NULL, updated_at_ms = ?1
             WHERE status IN ('leased', 'running') AND lease_expires_ms < ?1",
            params![now],
        )?;
        Ok(())
    }

    pub fn requeue_agent_tasks(&self, agent_id: &str) -> Result<(), StoreError> {
        let now = unix_ms();
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        connection.execute(
            "UPDATE tasks SET status = 'queued', agent_id = NULL, lease_expires_ms = 0,
             updated_at_ms = ?1 WHERE agent_id = ?2 AND status IN ('leased', 'running')",
            params![now, agent_id],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<TaskRecord>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT task_id, lease_epoch, device_uuid, program, args_json, env_json,
                    workdir, output_path, status
             FROM tasks ORDER BY created_at_ms",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(TaskRecord {
                task_id: row.get(0)?,
                lease_epoch: row.get(1)?,
                device_uuid: row.get(2)?,
                program: row.get(3)?,
                args: parse_json(row.get::<_, String>(4)?)?,
                env: parse_json(row.get::<_, String>(5)?)?,
                workdir: row.get(6)?,
                output_path: row.get(7)?,
                status: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }
}

fn parse_json<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str::<Value>(&value)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
        .and_then(|json| {
            serde_json::from_value(json)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
        })
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

mod events;
mod results;

#[cfg(test)]
mod tests;
