pub mod agent_operations;
pub mod error;
pub mod migrations;
pub mod models;
pub mod operations;
pub mod schema;

use error::DbError;
use rusqlite::Connection;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self, rusqlite::Error> {
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
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        f(&conn)
    }
}
