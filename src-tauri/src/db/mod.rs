pub mod models;
pub mod schema;

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
}
