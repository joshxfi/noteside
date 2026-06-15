use serde::{Serialize, Serializer};

/// Backend error type. Serializes to a plain string so the frontend receives a
/// rejected promise with a readable message.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid pattern: {0}")]
    Regex(#[from] regex::Error),
    #[error("no notebook is open")]
    NoVault,
    #[error("{0}")]
    Msg(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
