use std::path::PathBuf;

use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Clone, Default)]
pub struct EnrollmentGuard {
    token_file: Option<PathBuf>,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("enrollment token file is unreadable: {0}")]
    Read(#[from] std::io::Error),
    #[error("enrollment token is invalid")]
    Invalid,
    #[error("enrollment token file is empty")]
    Empty,
}

impl EnrollmentGuard {
    pub fn from_file(token_file: Option<PathBuf>) -> Self {
        Self { token_file }
    }

    pub fn validate(&self, presented: &str) -> Result<(), AuthError> {
        let Some(path) = &self.token_file else {
            return Ok(());
        };
        let expected = std::fs::read_to_string(path)?.trim().to_string();
        if expected.is_empty() || presented.is_empty() {
            return Err(AuthError::Empty);
        }
        if constant_time_digest_eq(expected.as_bytes(), presented.as_bytes()) {
            Ok(())
        } else {
            Err(AuthError::Invalid)
        }
    }
}

fn constant_time_digest_eq(expected: &[u8], presented: &[u8]) -> bool {
    let expected_digest = Sha256::digest(expected);
    let presented_digest = Sha256::digest(presented);
    let mut difference = 0u8;
    for (left, right) in expected_digest.iter().zip(presented_digest.iter()) {
        difference |= left ^ right;
    }
    difference == 0 && expected.len() == presented.len()
}
