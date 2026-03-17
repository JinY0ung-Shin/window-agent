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
        Migration {
            version: 4,
            description: "Tool call support: message tool fields, memory_notes, tool_call_logs",
            sql: "",  // handled by custom migration function
        },
        Migration {
            version: 5,
            description: "Add active_skills column to conversations",
            sql: "",  // handled by custom migration function
        },
        Migration {
            version: 6,
            description: "Rename default agent display name from 매니저 to 팀장",
            sql: "",  // handled by custom migration function
        },
        Migration {
            version: 7,
            description: "Browser automation: browser_artifacts table + tool_call_logs.artifact_id",
            sql: "",  // handled by custom migration function
        },
        Migration {
            version: 8,
            description: "Add FK + screenshot_path to browser_artifacts",
            sql: "",  // handled by custom migration function
        },
        Migration {
            version: 9,
            description: "P2P network: contacts, peer_threads, peer_messages, outbox",
            sql: "",  // handled by custom migration function
        },
    ]
}

/// Migration v4 with safe ALTER TABLE (skips columns that already exist).
fn migrate_v3_to_v4(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Check existing columns on messages table
    let has_column = |table: &str, col: &str| -> bool {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        cols.contains(&col.to_string())
    };

    // Add tool columns to messages (skip if already present)
    if !has_column("messages", "tool_call_id") {
        conn.execute_batch("ALTER TABLE messages ADD COLUMN tool_call_id TEXT;")?;
    }
    if !has_column("messages", "tool_name") {
        conn.execute_batch("ALTER TABLE messages ADD COLUMN tool_name TEXT;")?;
    }
    if !has_column("messages", "tool_input") {
        conn.execute_batch("ALTER TABLE messages ADD COLUMN tool_input TEXT;")?;
    }

    // Create memory_notes table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_notes (
            id         TEXT PRIMARY KEY,
            agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            title      TEXT NOT NULL,
            content    TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_memory_notes_agent_id ON memory_notes(agent_id);",
    )?;

    // Create tool_call_logs table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tool_call_logs (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
            tool_name       TEXT NOT NULL,
            tool_input      TEXT NOT NULL,
            tool_output     TEXT,
            status          TEXT NOT NULL DEFAULT 'pending',
            duration_ms     INTEGER,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tool_call_logs_conversation ON tool_call_logs(conversation_id);",
    )?;

    Ok(())
}

/// Migration v5: add active_skills column to conversations.
fn migrate_v4_to_v5(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_column = |table: &str, col: &str| -> bool {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        cols.contains(&col.to_string())
    };

    if !has_column("conversations", "active_skills") {
        conn.execute_batch("ALTER TABLE conversations ADD COLUMN active_skills TEXT;")?;
    }

    Ok(())
}

/// Migration v6: rename default agent display name from 매니저 to 팀장.
fn migrate_v5_to_v6(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "UPDATE agents SET name = '팀장',
           description = '다른 직원을 안내하고 사용자의 질문에 답하는 팀장'
           WHERE folder_name = '매니저' AND is_default = 1;",
    )?;
    Ok(())
}

/// Migration v7: browser_artifacts table + artifact_id on tool_call_logs.
fn migrate_v6_to_v7(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS browser_artifacts (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            snapshot_full   TEXT NOT NULL,
            ref_map_json    TEXT NOT NULL,
            url             TEXT NOT NULL,
            title           TEXT NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_browser_artifacts_conversation ON browser_artifacts(conversation_id);",
    )?;

    // Add artifact_id column to tool_call_logs if not present
    let has_column = |table: &str, col: &str| -> bool {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        cols.contains(&col.to_string())
    };

    if !has_column("tool_call_logs", "artifact_id") {
        conn.execute_batch("ALTER TABLE tool_call_logs ADD COLUMN artifact_id TEXT;")?;
    }

    Ok(())
}

/// Migration v8: recreate browser_artifacts with FK + screenshot_path.
fn migrate_v7_to_v8(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS browser_artifacts_new (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            snapshot_full   TEXT NOT NULL,
            ref_map_json    TEXT NOT NULL,
            url             TEXT NOT NULL,
            title           TEXT NOT NULL,
            screenshot_path TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        INSERT OR IGNORE INTO browser_artifacts_new (id, session_id, conversation_id, snapshot_full, ref_map_json, url, title, created_at)
            SELECT id, session_id, conversation_id, snapshot_full, ref_map_json, url, title, created_at FROM browser_artifacts;
        DROP TABLE IF EXISTS browser_artifacts;
        ALTER TABLE browser_artifacts_new RENAME TO browser_artifacts;
        CREATE INDEX IF NOT EXISTS idx_browser_artifacts_conversation ON browser_artifacts(conversation_id);",
    )?;
    Ok(())
}

/// Migration v9: P2P network tables — contacts, peer_threads, peer_messages, outbox.
fn migrate_v8_to_v9(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS contacts (
            id                TEXT PRIMARY KEY,
            peer_id           TEXT NOT NULL UNIQUE,
            public_key        TEXT NOT NULL,
            display_name      TEXT NOT NULL,
            agent_name        TEXT NOT NULL DEFAULT '',
            agent_description TEXT NOT NULL DEFAULT '',
            local_agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
            mode              TEXT NOT NULL DEFAULT 'secretary',
            capabilities_json TEXT NOT NULL DEFAULT '{\"can_send_messages\":true,\"can_read_agent_info\":true,\"can_request_tasks\":false,\"can_access_tools\":false,\"can_write_vault\":false}',
            status            TEXT NOT NULL DEFAULT 'pending',
            invite_card_raw   TEXT,
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_peer_id ON contacts(peer_id);
        CREATE INDEX IF NOT EXISTS idx_contacts_local_agent ON contacts(local_agent_id);

        CREATE TABLE IF NOT EXISTS peer_threads (
            id              TEXT PRIMARY KEY,
            contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            local_agent_id  TEXT REFERENCES agents(id) ON DELETE SET NULL,
            title           TEXT NOT NULL DEFAULT '',
            summary         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_peer_threads_contact ON peer_threads(contact_id);

        CREATE TABLE IF NOT EXISTS peer_messages (
            id                TEXT PRIMARY KEY,
            thread_id         TEXT NOT NULL REFERENCES peer_threads(id) ON DELETE CASCADE,
            message_id_unique TEXT NOT NULL UNIQUE,
            correlation_id    TEXT,
            direction         TEXT NOT NULL,
            sender_agent      TEXT NOT NULL DEFAULT '',
            content           TEXT NOT NULL,
            approval_state    TEXT NOT NULL DEFAULT 'none',
            delivery_state    TEXT NOT NULL DEFAULT 'pending',
            retry_count       INTEGER NOT NULL DEFAULT 0,
            raw_envelope      TEXT,
            created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_peer_messages_thread ON peer_messages(thread_id);
        CREATE INDEX IF NOT EXISTS idx_peer_messages_unique ON peer_messages(message_id_unique);

        CREATE TABLE IF NOT EXISTS outbox (
            id              TEXT PRIMARY KEY,
            peer_message_id TEXT NOT NULL REFERENCES peer_messages(id) ON DELETE CASCADE,
            target_peer_id  TEXT NOT NULL,
            attempts        INTEGER NOT NULL DEFAULT 0,
            next_retry_at   TEXT,
            status          TEXT NOT NULL DEFAULT 'pending',
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
        CREATE INDEX IF NOT EXISTS idx_outbox_target ON outbox(target_peer_id);",
    )?;
    Ok(())
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
            if migration.version == 4 {
                // v4 uses custom migration with safe ALTER TABLE checks
                migrate_v3_to_v4(&tx)?;
            } else if migration.version == 5 {
                migrate_v4_to_v5(&tx)?;
            } else if migration.version == 6 {
                migrate_v5_to_v6(&tx)?;
            } else if migration.version == 7 {
                migrate_v6_to_v7(&tx)?;
            } else if migration.version == 8 {
                migrate_v7_to_v8(&tx)?;
            } else if migration.version == 9 {
                migrate_v8_to_v9(&tx)?;
            } else {
                tx.execute_batch(migration.sql)?;
            }
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
        assert_eq!(version, 9);
    }

    #[test]
    fn test_run_migrations_records_version() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        let version = current_version(&conn).unwrap();
        assert_eq!(version, 9);

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

        // Run remaining migrations (v3 + v4 + v5 + v6)
        run_migrations(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 9);

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

    #[test]
    fn test_v4_migration_creates_tables_and_columns() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 9);

        // Verify new tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tables.contains(&"memory_notes".to_string()));
        assert!(tables.contains(&"tool_call_logs".to_string()));

        // Verify tool columns on messages
        conn.execute(
            "INSERT INTO agents (id, folder_name, name, description, created_at, updated_at) VALUES ('a1', 'test', 'Test', '', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES ('c1', 'Chat', 'a1', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_name, tool_input, created_at) VALUES ('m1', 'c1', 'assistant', 'result', 'tc1', 'search', '{\"q\":\"test\"}', '2024-01-01')",
            [],
        ).unwrap();

        let tool_name: Option<String> = conn
            .query_row("SELECT tool_name FROM messages WHERE id = 'm1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tool_name.as_deref(), Some("search"));
    }

    #[test]
    fn test_v4_migration_preserves_existing_messages() {
        let conn = setup_conn();

        // Run v1-v3 first
        ensure_migrations_table(&conn).unwrap();
        for m in &all_migrations()[..3] {
            let tx = conn.unchecked_transaction().unwrap();
            if m.version == 4 {
                migrate_v3_to_v4(&tx).unwrap();
            } else {
                tx.execute_batch(m.sql).unwrap();
            }
            tx.execute(
                "INSERT INTO _migrations (version, description) VALUES (?1, ?2)",
                rusqlite::params![m.version, m.description],
            ).unwrap();
            tx.commit().unwrap();
        }

        // Insert data at v3 level
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

        // Run v4 + v5 + v6
        run_migrations(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 9);

        // Verify existing data preserved, new columns are NULL
        let content: String = conn
            .query_row("SELECT content FROM messages WHERE id = 'm1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(content, "hello");

        let tool_name: Option<String> = conn
            .query_row("SELECT tool_name FROM messages WHERE id = 'm1'", [], |row| row.get(0))
            .unwrap();
        assert!(tool_name.is_none());
    }

    #[test]
    fn test_v5_migration_adds_active_skills_column() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 9);

        // Verify active_skills column exists
        conn.execute(
            "INSERT INTO agents (id, folder_name, name, description, created_at, updated_at) VALUES ('a1', 'test', 'Test', '', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES ('c1', 'Chat', 'a1', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();

        // active_skills should be NULL by default
        let skills: Option<String> = conn
            .query_row("SELECT active_skills FROM conversations WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert!(skills.is_none());

        // Can set active_skills
        conn.execute(
            "UPDATE conversations SET active_skills = '[\"web-search\",\"code-gen\"]' WHERE id = 'c1'",
            [],
        ).unwrap();

        let skills: Option<String> = conn
            .query_row("SELECT active_skills FROM conversations WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(skills.as_deref(), Some("[\"web-search\",\"code-gen\"]"));
    }

    #[test]
    fn test_v9_migration_creates_p2p_tables() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 9);

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"contacts".to_string()));
        assert!(tables.contains(&"peer_threads".to_string()));
        assert!(tables.contains(&"peer_messages".to_string()));
        assert!(tables.contains(&"outbox".to_string()));
    }

    #[test]
    fn test_v9_contacts_crud() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        // Insert an agent for local_agent_id FK
        conn.execute(
            "INSERT INTO agents (id, folder_name, name, description, created_at, updated_at) VALUES ('a1', 'test', 'Test', '', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();

        // Insert a contact
        conn.execute(
            "INSERT INTO contacts (id, peer_id, public_key, display_name, local_agent_id) VALUES ('c1', 'peer123', 'pk_abc', 'Alice', 'a1')",
            [],
        ).unwrap();

        let display_name: String = conn
            .query_row("SELECT display_name FROM contacts WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(display_name, "Alice");

        // peer_id UNIQUE constraint
        let result = conn.execute(
            "INSERT INTO contacts (id, peer_id, public_key, display_name) VALUES ('c2', 'peer123', 'pk_def', 'Bob')",
            [],
        );
        assert!(result.is_err(), "peer_id should be unique");

        // ON DELETE SET NULL for local_agent_id
        conn.execute("DELETE FROM agents WHERE id = 'a1'", []).unwrap();
        let local_agent: Option<String> = conn
            .query_row("SELECT local_agent_id FROM contacts WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert!(local_agent.is_none(), "local_agent_id should be set to NULL on agent delete");
    }

    #[test]
    fn test_v9_peer_threads_cascade() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO contacts (id, peer_id, public_key, display_name) VALUES ('c1', 'peer1', 'pk1', 'Alice')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO peer_threads (id, contact_id, title) VALUES ('t1', 'c1', 'Thread 1')",
            [],
        ).unwrap();

        // Cascade delete threads when contact is deleted
        conn.execute("DELETE FROM contacts WHERE id = 'c1'", []).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM peer_threads WHERE id = 't1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "peer_threads should cascade on contact delete");
    }

    #[test]
    fn test_v9_peer_messages_duplicate_handling() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO contacts (id, peer_id, public_key, display_name) VALUES ('c1', 'peer1', 'pk1', 'Alice')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO peer_threads (id, contact_id) VALUES ('t1', 'c1')",
            [],
        ).unwrap();

        // Insert a message
        conn.execute(
            "INSERT INTO peer_messages (id, thread_id, message_id_unique, direction, content) VALUES ('m1', 't1', 'unique-123', 'inbound', 'hello')",
            [],
        ).unwrap();

        // Duplicate message_id_unique should be rejected (UNIQUE constraint)
        let result = conn.execute(
            "INSERT INTO peer_messages (id, thread_id, message_id_unique, direction, content) VALUES ('m2', 't1', 'unique-123', 'inbound', 'hello again')",
            [],
        );
        assert!(result.is_err(), "message_id_unique should enforce uniqueness");

        // INSERT OR IGNORE should silently skip duplicates
        conn.execute(
            "INSERT OR IGNORE INTO peer_messages (id, thread_id, message_id_unique, direction, content) VALUES ('m2', 't1', 'unique-123', 'inbound', 'hello again')",
            [],
        ).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM peer_messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "duplicate should be ignored");
    }

    #[test]
    fn test_v9_outbox_fk_cascade() {
        let conn = setup_conn();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO contacts (id, peer_id, public_key, display_name) VALUES ('c1', 'peer1', 'pk1', 'Alice')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO peer_threads (id, contact_id) VALUES ('t1', 'c1')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO peer_messages (id, thread_id, message_id_unique, direction, content) VALUES ('m1', 't1', 'u1', 'outbound', 'hi')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO outbox (id, peer_message_id, target_peer_id) VALUES ('o1', 'm1', 'peer1')",
            [],
        ).unwrap();

        // Cascade: delete contact → thread → message → outbox
        conn.execute("DELETE FROM contacts WHERE id = 'c1'", []).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM outbox", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "outbox should cascade through peer_messages → peer_threads → contacts");
    }
}
