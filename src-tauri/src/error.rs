use crate::db::error::DbError;
use serde::Serialize;
use std::fmt;

/// Unified application error type.
/// New services use AppError instead of raw `String` errors.
/// Existing Tauri commands are not changed in this phase.
#[derive(Debug)]
pub enum AppError {
    Database(String),
    Api(String),
    Validation(String),
    Io(String),
    NotFound(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Database(msg) => write!(f, "Database error: {msg}"),
            AppError::Api(msg) => write!(f, "API error: {msg}"),
            AppError::Validation(msg) => write!(f, "Validation error: {msg}"),
            AppError::Io(msg) => write!(f, "IO error: {msg}"),
            AppError::NotFound(msg) => write!(f, "Not found: {msg}"),
        }
    }
}

impl From<DbError> for AppError {
    fn from(e: DbError) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Api(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_variants() {
        assert_eq!(
            AppError::Database("conn lost".into()).to_string(),
            "Database error: conn lost"
        );
        assert_eq!(
            AppError::Api("timeout".into()).to_string(),
            "API error: timeout"
        );
        assert_eq!(
            AppError::Validation("bad input".into()).to_string(),
            "Validation error: bad input"
        );
        assert_eq!(
            AppError::Io("not found".into()).to_string(),
            "IO error: not found"
        );
        assert_eq!(
            AppError::NotFound("item".into()).to_string(),
            "Not found: item"
        );
    }

    #[test]
    fn test_from_db_error() {
        let db_err = DbError::Sqlite("constraint".into());
        let app_err: AppError = db_err.into();
        assert!(matches!(app_err, AppError::Database(_)));
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "no such file");
        let app_err: AppError = io_err.into();
        assert!(matches!(app_err, AppError::Io(_)));
    }

    #[test]
    fn test_serialize() {
        let err = AppError::Api("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"API error: test\"");
    }

    #[test]
    fn test_into_string() {
        let err = AppError::Validation("oops".into());
        let s: String = err.into();
        assert_eq!(s, "Validation error: oops");
    }
}
