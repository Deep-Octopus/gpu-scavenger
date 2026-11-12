use std::fmt::Write;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::agent::AgentError;

const MAX_RESULT_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const HASH_BUFFER_BYTES: usize = 1024 * 1024;

pub(crate) fn digest_file(path: &Path) -> Result<(u64, String), AgentError> {
    let metadata =
        std::fs::metadata(path).map_err(|error| AgentError::Artifact(error.to_string()))?;
    if !metadata.is_file() {
        return Err(AgentError::Artifact(
            "output path is not a regular file".to_string(),
        ));
    }
    if metadata.len() > MAX_RESULT_BYTES {
        return Err(AgentError::Artifact(format!(
            "output exceeds {} byte limit",
            MAX_RESULT_BYTES
        )));
    }
    let mut file = File::open(path).map_err(|error| AgentError::Artifact(error.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; HASH_BUFFER_BYTES];
    let mut read_bytes: u64 = 0;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| AgentError::Artifact(error.to_string()))?;
        if read == 0 {
            break;
        }
        read_bytes = read_bytes.saturating_add(read as u64);
        hasher.update(&buffer[..read]);
    }
    if read_bytes != metadata.len() {
        return Err(AgentError::Artifact(
            "output changed while hashing".to_string(),
        ));
    }
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}")
            .map_err(|error| AgentError::Artifact(error.to_string()))?;
    }
    Ok((metadata.len(), encoded))
}

#[cfg(test)]
mod tests {
    use super::digest_file;

    #[test]
    fn hashes_result_bytes_with_stable_sha256() -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!(
            "gpu-scavenger-artifact-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        ));
        std::fs::write(&path, b"gpu-scavenger-result\n")?;
        let result = digest_file(&path)?;
        assert_eq!(result.0, 21);
        assert_eq!(
            result.1,
            "339cec3beb0e1536ec49f086456fc2c7048f6f60d627a21f78b2091953328249"
        );
        std::fs::remove_file(path)?;
        Ok(())
    }
}
