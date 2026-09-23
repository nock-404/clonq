use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("file system: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("database: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("app: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("config: {0}")]
    Config(String),
    #[error("{0}")]
    Job(String),
}

/// Commands hand errors to the frontend as plain messages.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
