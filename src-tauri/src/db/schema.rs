use super::migrations;
use rusqlite::Connection;

pub fn initialize(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    migrations::run_migrations(conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        conn
    }

    #[test]
    fn test_initialize_creates_tables() {
        let conn = setup_conn();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tables.contains(&"conversations".to_string()));
        assert!(tables.contains(&"messages".to_string()));
        assert!(tables.contains(&"agents".to_string()));
        assert!(tables.contains(&"memory_notes".to_string()));
        assert!(tables.contains(&"tool_call_logs".to_string()));
    }

    #[test]
    fn test_initialize_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        initialize(&conn).unwrap(); // should not error
    }

    #[test]
    fn test_foreign_keys_enabled() {
        let conn = setup_conn();
        let result = conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m1', 'nonexistent', 'user', 'hi', '2024-01-01')",
            [],
        );
        assert!(result.is_err());
    }
}
