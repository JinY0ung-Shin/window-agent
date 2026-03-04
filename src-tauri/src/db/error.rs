use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(String),

    #[error("Lock error")]
    Lock,
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e.to_string())
    }
}

impl From<DbError> for String {
    fn from(e: DbError) -> Self {
        e.to_string()
    }
}
