mod consolidation_ops;
mod conversation_ops;
pub mod import_ops;
mod message_ops;
mod summary_ops;

use super::error::DbError;
use super::Database;

pub fn with_transaction<F, T>(db: &Database, f: F) -> Result<T, DbError>
where
    F: FnOnce(&rusqlite::Transaction) -> Result<T, rusqlite::Error>,
{
    let mut conn = db.conn.lock().map_err(|_| DbError::lock())?;
    let tx = conn.transaction()?;
    let result = f(&tx)?;
    tx.commit()?;
    Ok(result)
}

// Re-export everything for backward compatibility
pub use consolidation_ops::*;
pub use conversation_ops::*;
pub use message_ops::*;
pub use summary_ops::*;
