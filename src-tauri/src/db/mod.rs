pub mod agent_operations;
pub mod cron_operations;
pub mod error;
pub mod migrations;
pub mod models;
pub mod operations;
pub mod schema;
pub mod team_operations;

use error::DbError;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self, rusqlite::Error> {
        // Check schema compatibility before opening the final connection.
        // If the DB file exists but has an incompatible schema, delete it.
        if Path::new(db_path).exists() && migrations::needs_reset(db_path) {
            tracing::warn!("Schema mismatch detected, recreating database");
            // Remove DB file and WAL/SHM sidecars — fail loudly if unable
            std::fs::remove_file(db_path).map_err(|e| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                    Some(format!("Failed to remove incompatible DB '{}': {}", db_path, e)),
                )
            })?;
            // Sidecars may not exist, so ignore NotFound but propagate other errors
            for suffix in &["-wal", "-shm"] {
                let sidecar = format!("{db_path}{suffix}");
                if let Err(e) = std::fs::remove_file(&sidecar) {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        return Err(rusqlite::Error::SqliteFailure(
                            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                            Some(format!("Failed to remove sidecar '{}': {}", sidecar, e)),
                        ));
                    }
                }
            }
        }

        let conn = Connection::open(db_path)?;
        schema::initialize(&conn)?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, rusqlite::Error> {
        let conn = Connection::open_in_memory()?;
        schema::initialize(&conn)?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    /// Execute a closure with a borrowed connection, handling lock acquisition.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T, DbError>
    where
        F: FnOnce(&Connection) -> Result<T, DbError>,
    {
        let conn = self.conn.lock().map_err(|_| DbError::lock())?;
        f(&conn)
    }
}
