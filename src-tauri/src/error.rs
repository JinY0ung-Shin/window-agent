use crate::db::error::DbError;
use serde::Serialize;

/// Unified application error type for all Tauri commands and services.
///
/// At the Tauri command boundary, AppError serializes to a plain string
/// (via the Serialize impl), preserving the frontend's expectation of
/// error strings.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),
    #[error("API error: {0}")]
    Api(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Relay error: {0}")]
    Relay(String),
    #[error("Vault error: {0}")]
    Vault(String),
    #[error("Config error: {0}")]
    Config(String),
    #[error("Lock error: {0}")]
    Lock(String),
    #[error("JSON error: {0}")]
    Json(String),
}

// ── From trait implementations ──

impl From<DbError> for AppError {
    fn from(e: DbError) -> Self {
        match e {
            DbError::Sqlite(msg) => AppError::Database(msg),
        }
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

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Json(e.to_string())
    }
}

/// Allows ergonomic conversion from bare `String` errors (e.g. from
/// legacy code or libraries that return `Result<T, String>`).
impl From<String> for AppError {
    fn from(msg: String) -> Self {
        AppError::Io(msg)
    }
}

// ── Serialization ──

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
        assert_eq!(
            AppError::Relay("disconnected".into()).to_string(),
            "Relay error: disconnected"
        );
        assert_eq!(
            AppError::Vault("corrupt".into()).to_string(),
            "Vault error: corrupt"
        );
        assert_eq!(
            AppError::Config("missing key".into()).to_string(),
            "Config error: missing key"
        );
        assert_eq!(
            AppError::Lock("poisoned".into()).to_string(),
            "Lock error: poisoned"
        );
        assert_eq!(
            AppError::Json("parse".into()).to_string(),
            "JSON error: parse"
        );
    }

    #[test]
    fn test_from_db_error() {
        let db_err = DbError::Sqlite("constraint".into());
        let app_err: AppError = db_err.into();
        assert!(matches!(app_err, AppError::Database(_)));
    }

    #[test]
    fn test_from_db_lock_error() {
        let db_err = DbError::lock();
        let app_err: AppError = db_err.into();
        match app_err {
            AppError::Database(msg) => assert!(msg.contains("lock"), "expected lock in message, got: {msg}"),
            other => panic!("expected Database variant, got: {other:?}"),
        }
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "no such file");
        let app_err: AppError = io_err.into();
        assert!(matches!(app_err, AppError::Io(_)));
    }

    #[test]
    fn test_from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}")
            .unwrap_err();
        let app_err: AppError = json_err.into();
        assert!(matches!(app_err, AppError::Json(_)));
    }

    #[test]
    fn test_from_string() {
        let app_err: AppError = "something went wrong".to_string().into();
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

    // ── Serialization compatibility tests ──

    #[test]
    fn test_serialization_compatibility() {
        assert_eq!(
            serde_json::to_string(&AppError::Database("test error".into())).unwrap(),
            "\"Database error: test error\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Api("timeout".into())).unwrap(),
            "\"API error: timeout\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Validation("bad".into())).unwrap(),
            "\"Validation error: bad\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Io("disk full".into())).unwrap(),
            "\"IO error: disk full\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::NotFound("item".into())).unwrap(),
            "\"Not found: item\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Relay("disconnected".into())).unwrap(),
            "\"Relay error: disconnected\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Vault("corrupt".into())).unwrap(),
            "\"Vault error: corrupt\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Config("missing key".into())).unwrap(),
            "\"Config error: missing key\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Lock("poisoned".into())).unwrap(),
            "\"Lock error: poisoned\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::Json("parse".into())).unwrap(),
            "\"JSON error: parse\""
        );
    }
}
