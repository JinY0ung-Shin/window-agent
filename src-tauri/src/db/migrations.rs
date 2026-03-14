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
        Migration {
            version: 2,
            description: "Agents table + conversations.agent_id",
            sql: "
                CREATE TABLE IF NOT EXISTS agents (
                    id               TEXT PRIMARY KEY,
                    folder_name      TEXT NOT NULL UNIQUE,
                    name             TEXT NOT NULL,
                    avatar           TEXT,
                    description      TEXT NOT NULL DEFAULT '',
                    model            TEXT,
                    temperature      REAL,
                    thinking_enabled INTEGER,
                    thinking_budget  INTEGER,
                    is_default       INTEGER DEFAULT 0,
                    sort_order       INTEGER DEFAULT 0,
                    created_at       TEXT NOT NULL,
                    updated_at       TEXT NOT NULL
                );

                -- Delete all existing conversations (pre-agent era)
                DELETE FROM messages;
                DELETE FROM conversations;

                -- Recreate conversations with agent_id column
                -- SQLite doesn't support ALTER TABLE ADD COLUMN with FK,
                -- so we recreate the table.
                CREATE TABLE conversations_new (
                    id         TEXT PRIMARY KEY,
                    title      TEXT NOT NULL,
                    agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                DROP TABLE conversations;
                ALTER TABLE conversations_new RENAME TO conversations;

                CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
            ",
        },
        Migration {
            version: 3,
            description: "Add summary columns to conversations",
            sql: "
                ALTER TABLE conversations ADD COLUMN summary TEXT;
                ALTER TABLE conversations ADD COLUMN summary_up_to_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL;
            ",
        },
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
        assert!(tables.contains(&"agents".to_string()));
        assert!(tables.contains(&"_migrations".to_string()));
    }

    #[test]
    fn test_run_migrations_is_idempotent() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // should not error

        let version = current_version(&conn).unwrap();
        assert_eq!(version, 3);
    }

    #[test]
    fn test_run_migrations_records_version() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        let version = current_version(&conn).unwrap();
        assert_eq!(version, 3);

        let desc: String = conn
            .query_row(
                "SELECT description FROM _migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(desc.contains("Initial schema"));

        let desc2: String = conn
            .query_row(
                "SELECT description FROM _migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(desc2.contains("Agents"));
    }

    #[test]
    fn test_conversations_has_agent_id() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        // Insert an agent first
        conn.execute(
            "INSERT INTO agents (id, folder_name, name, description, created_at, updated_at) VALUES ('a1', 'test', 'Test', '', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();

        // Insert a conversation with agent_id
        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES ('c1', 'Test', 'a1', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();

        let agent_id: String = conn
            .query_row("SELECT agent_id FROM conversations WHERE id = 'c1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(agent_id, "a1");
    }

    #[test]
    fn test_v2_migration_deletes_old_data() {
        let conn = setup_conn();

        // Run v1 only first
        ensure_migrations_table(&conn).unwrap();
        let v1 = &all_migrations()[0];
        let tx = conn.unchecked_transaction().unwrap();
        tx.execute_batch(v1.sql).unwrap();
        tx.execute(
            "INSERT INTO _migrations (version, description) VALUES (?1, ?2)",
            rusqlite::params![v1.version, v1.description],
        ).unwrap();
        tx.commit().unwrap();

        // Insert old data
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('old1', 'Old', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();

        // Now run all migrations (v2 should clear old conversations)
        run_migrations(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_v3_migration_upgrade_preserves_data() {
        let conn = setup_conn();

        // Run v1 + v2 first
        ensure_migrations_table(&conn).unwrap();
        for m in &all_migrations()[..2] {
            let tx = conn.unchecked_transaction().unwrap();
            tx.execute_batch(m.sql).unwrap();
            tx.execute(
                "INSERT INTO _migrations (version, description) VALUES (?1, ?2)",
                rusqlite::params![m.version, m.description],
            ).unwrap();
            tx.commit().unwrap();
        }

        // Insert test data at v2 level
        conn.execute(
            "INSERT INTO agents (id, folder_name, name, description, created_at, updated_at) VALUES ('a1', 'test', 'Test', '', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES ('c1', 'My Chat', 'a1', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m1', 'c1', 'user', 'hello', '2024-01-01')",
            [],
        ).unwrap();

        // Run v3 migration
        run_migrations(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 3);

        // Verify existing data is preserved
        let title: String = conn
            .query_row("SELECT title FROM conversations WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "My Chat");

        let content: String = conn
            .query_row("SELECT content FROM messages WHERE id = 'm1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(content, "hello");

        // Verify new columns exist and are NULL by default
        let summary: Option<String> = conn
            .query_row("SELECT summary FROM conversations WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert!(summary.is_none());

        let summary_msg_id: Option<String> = conn
            .query_row("SELECT summary_up_to_message_id FROM conversations WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert!(summary_msg_id.is_none());
    }

    #[test]
    fn test_v3_summary_up_to_message_id_fk() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO agents (id, folder_name, name, description, created_at, updated_at) VALUES ('a1', 'test', 'Test', '', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES ('c1', 'Chat', 'a1', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m1', 'c1', 'user', 'hello', '2024-01-01')",
            [],
        ).unwrap();

        // Can set summary_up_to_message_id to a valid message id
        conn.execute(
            "UPDATE conversations SET summary = 'test summary', summary_up_to_message_id = 'm1' WHERE id = 'c1'",
            [],
        ).unwrap();

        // Delete the message — summary_up_to_message_id should become NULL (ON DELETE SET NULL)
        conn.execute("DELETE FROM messages WHERE id = 'm1'", []).unwrap();

        let summary_msg_id: Option<String> = conn
            .query_row("SELECT summary_up_to_message_id FROM conversations WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert!(summary_msg_id.is_none(), "ON DELETE SET NULL should clear summary_up_to_message_id");
    }
}
