use std::path::Path;
use std::time::{Duration, Instant};

use scavenger_core::CheckpointRequest;

use crate::agent::AgentError;
use crate::artifact::digest_file;

const MAX_WAIT_MS: u64 = 300_000;
const POLL_MS: u64 = 50;

pub(crate) fn wait_for_checkpoint(
    request: &CheckpointRequest,
) -> Result<(u64, String), AgentError> {
    let Some(path) = request.checkpoint_path.as_deref() else {
        return Err(AgentError::Artifact(
            "checkpoint path is required for a checkpointed task".to_string(),
        ));
    };
    let deadline = Instant::now()
        .checked_add(Duration::from_millis(request.deadline_ms.min(MAX_WAIT_MS)))
        .ok_or_else(|| AgentError::Artifact("checkpoint deadline overflow".to_string()))?;
    loop {
        if let Some(result) = readable_checkpoint(path)? {
            return Ok(result);
        }
        if Instant::now() >= deadline {
            return Err(AgentError::Artifact(
                "checkpoint file did not become readable before deadline".to_string(),
            ));
        }
        std::thread::sleep(Duration::from_millis(POLL_MS));
    }
}

fn readable_checkpoint(path: &Path) -> Result<Option<(u64, String)>, AgentError> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.len() > 0 => digest_file(path).map(Some),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AgentError::Artifact(error.to_string())),
    }
}
