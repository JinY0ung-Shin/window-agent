use rusqlite::Connection;

/// Each migration has a version number and SQL to execute.
struct Migration {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

/// All migrations, ordered by version.
fn all_migrations() -> &'static [Migration] {
    &[
        Migration {
            version: 1,
            description: "Initial schema: conversations + messages",
            sql: "
                CREATE TABLE IF NOT EXISTS conversations (
                    id         TEXT PRIMARY KEY,
                    title      TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id              TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role            TEXT NOT NULL,
                    content         TEXT NOT NULL,
                    created_at      TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
                CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
            ",
        },
        // Phase 1: Add migration v2 here for agents table
    ]
}

/// Ensure the _migrations tracking table exists.
fn ensure_migrations_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version     INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
}

/// Get the current (highest applied) migration version. Returns 0 if none applied.
fn current_version(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _migrations",
        [],
        |row| row.get(0),
    )
}

/// Run all pending migrations in order.
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    ensure_migrations_table(conn)?;
    let current = current_version(conn)?;

    for migration in all_migrations() {
        if migration.version > current {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(migration.sql)?;
            tx.execute(
                "INSERT INTO _migrations (version, description) VALUES (?1, ?2)",
                rusqlite::params![migration.version, migration.description],
            )?;
            tx.commit()?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn
    }

    #[test]
    fn test_run_migrations_creates_tables() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"conversations".to_string()));
        assert!(tables.contains(&"messages".to_string()));
        assert!(tables.contains(&"_migrations".to_string()));
    }

    #[test]
    fn test_run_migrations_is_idempotent() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // should not error

        let version = current_version(&conn).unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn test_run_migrations_records_version() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        let version = current_version(&conn).unwrap();
        assert_eq!(version, 1);

        let desc: String = conn
            .query_row(
                "SELECT description FROM _migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(desc.contains("Initial schema"));
    }

    #[test]
    fn test_existing_data_preserved() {
        let conn = setup_conn();

        // Simulate existing DB by creating tables manually
        conn.execute_batch(
            "CREATE TABLE conversations (
                id TEXT PRIMARY KEY, title TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
                role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            INSERT INTO conversations VALUES ('c1', 'Test', '2024-01-01', '2024-01-01');
            INSERT INTO messages VALUES ('m1', 'c1', 'user', 'hello', '2024-01-01');",
        )
        .unwrap();

        // Running migrations should not destroy existing data
        run_migrations(&conn).unwrap();

        let title: String = conn
            .query_row("SELECT title FROM conversations WHERE id = 'c1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(title, "Test");

        let content: String = conn
            .query_row("SELECT content FROM messages WHERE id = 'm1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(content, "hello");
    }
}
