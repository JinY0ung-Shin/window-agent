use rusqlite::Connection;

/// Current schema version. Bump when the schema changes.
const SCHEMA_VERSION: i64 = 1;

/// Create all tables if they don't exist.
fn create_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
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

        CREATE TABLE IF NOT EXISTS conversations (
            id              TEXT PRIMARY KEY,
            title           TEXT NOT NULL,
            agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            summary         TEXT,
            summary_up_to_message_id TEXT,
            active_skills   TEXT,
            learning_mode   INTEGER DEFAULT 0,
            digest_id       TEXT,
            consolidated_at TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            tool_call_id    TEXT,
            tool_name       TEXT,
            tool_input      TEXT,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

        CREATE TABLE IF NOT EXISTS tool_call_logs (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
            tool_name       TEXT NOT NULL,
            tool_input      TEXT NOT NULL,
            tool_output     TEXT,
            status          TEXT NOT NULL DEFAULT 'pending',
            duration_ms     INTEGER,
            artifact_id     TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tool_call_logs_conversation ON tool_call_logs(conversation_id);

        CREATE TABLE IF NOT EXISTS browser_artifacts (
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
        CREATE INDEX IF NOT EXISTS idx_browser_artifacts_conversation ON browser_artifacts(conversation_id);

        CREATE TABLE IF NOT EXISTS contacts (
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
            addresses_json    TEXT,
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
        CREATE INDEX IF NOT EXISTS idx_outbox_target ON outbox(target_peer_id);
        ",
    )
}

/// Record the current schema version.
fn set_schema_version(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER PRIMARY KEY
        );",
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO _schema_version (version) VALUES (?1)",
        rusqlite::params![SCHEMA_VERSION],
    )?;
    Ok(())
}

/// Get the stored schema version. Returns None if the table doesn't exist.
fn get_schema_version(conn: &Connection) -> Option<i64> {
    conn.query_row(
        "SELECT version FROM _schema_version LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

/// Check if a DB file has a compatible schema version.
/// Returns true if the DB needs to be reset (incompatible or missing version).
pub fn needs_reset(db_path: &str) -> bool {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return true,
    };
    !matches!(get_schema_version(&conn), Some(v) if v == SCHEMA_VERSION)
}

/// Run idempotent incremental migrations for columns added after SCHEMA_VERSION 1.
/// Each migration checks if the column exists before attempting ALTER TABLE.
fn run_incremental_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Check if learning_mode column exists on conversations
    let has_learning_mode: bool = conn
        .prepare("PRAGMA table_info(conversations)")?
        .query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .any(|name| name == "learning_mode");

    if !has_learning_mode {
        conn.execute_batch(
            "ALTER TABLE conversations ADD COLUMN learning_mode INTEGER DEFAULT 0;"
        )?;
    }

    // Check for consolidation checkpoint columns
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(conversations)")?
        .query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .collect();

    if !columns.contains(&"digest_id".to_string()) {
        conn.execute_batch(
            "ALTER TABLE conversations ADD COLUMN digest_id TEXT;"
        )?;
    }
    if !columns.contains(&"consolidated_at".to_string()) {
        conn.execute_batch(
            "ALTER TABLE conversations ADD COLUMN consolidated_at TEXT;"
        )?;
    }

    // ── Team tables ──────────────────────────────────────────
    // Check if teams table exists (first team migration marker)
    let has_teams: bool = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'")?
        .query_map([], |row| {
            let name: String = row.get(0)?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .any(|_| true);

    if !has_teams {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS teams (
                id               TEXT PRIMARY KEY,
                name             TEXT NOT NULL,
                description      TEXT NOT NULL DEFAULT '',
                leader_agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                created_at       TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS team_members (
                id        TEXT PRIMARY KEY,
                team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                role      TEXT NOT NULL DEFAULT 'member',
                joined_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(team_id, agent_id)
            );
            CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
            CREATE INDEX IF NOT EXISTS idx_team_members_agent ON team_members(agent_id);

            CREATE TABLE IF NOT EXISTS team_runs (
                id               TEXT PRIMARY KEY,
                team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                leader_agent_id  TEXT NOT NULL,
                status           TEXT NOT NULL DEFAULT 'running',
                started_at       TEXT NOT NULL DEFAULT (datetime('now')),
                finished_at      TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_team_runs_team ON team_runs(team_id);
            CREATE INDEX IF NOT EXISTS idx_team_runs_conversation ON team_runs(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_team_runs_status ON team_runs(status);

            CREATE TABLE IF NOT EXISTS team_tasks (
                id                TEXT PRIMARY KEY,
                run_id            TEXT NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
                agent_id          TEXT NOT NULL,
                request_id        TEXT,
                task_description  TEXT NOT NULL DEFAULT '',
                status            TEXT NOT NULL DEFAULT 'queued',
                parent_message_id TEXT,
                result_summary    TEXT,
                started_at        TEXT,
                finished_at       TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_team_tasks_run ON team_tasks(run_id);
            CREATE INDEX IF NOT EXISTS idx_team_tasks_status ON team_tasks(status);
            ",
        )?;
    }

    // ── Add team_id to conversations ──
    if !columns.contains(&"team_id".to_string()) {
        conn.execute_batch(
            "ALTER TABLE conversations ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;"
        )?;
    }

    // ── Add sender_agent_id, team_run_id, team_task_id to messages ──
    let msg_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(messages)")?
        .query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .collect();

    if !msg_columns.contains(&"sender_agent_id".to_string()) {
        conn.execute_batch(
            "ALTER TABLE messages ADD COLUMN sender_agent_id TEXT;"
        )?;
    }
    if !msg_columns.contains(&"team_run_id".to_string()) {
        conn.execute_batch(
            "ALTER TABLE messages ADD COLUMN team_run_id TEXT;"
        )?;
    }
    if !msg_columns.contains(&"team_task_id".to_string()) {
        conn.execute_batch(
            "ALTER TABLE messages ADD COLUMN team_task_id TEXT;"
        )?;
    }

    // ── Add agent_id to tool_call_logs ──
    let tcl_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(tool_call_logs)")?
        .query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .collect();

    if !tcl_columns.contains(&"agent_id".to_string()) {
        conn.execute_batch(
            "ALTER TABLE tool_call_logs ADD COLUMN agent_id TEXT;"
        )?;
    }

    // ── Cron tables ─────────────────────────────────────────
    let has_cron_jobs: bool = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cron_jobs'")?
        .query_map([], |row| {
            let name: String = row.get(0)?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .any(|_| true);

    if !has_cron_jobs {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS cron_jobs (
                id              TEXT PRIMARY KEY,
                agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                name            TEXT NOT NULL,
                description     TEXT NOT NULL DEFAULT '',
                schedule_type   TEXT NOT NULL CHECK(schedule_type IN ('at','every','cron')),
                schedule_value  TEXT NOT NULL,
                prompt          TEXT NOT NULL,
                enabled         INTEGER NOT NULL DEFAULT 1,
                last_run_at     TEXT,
                next_run_at     TEXT,
                last_result     TEXT CHECK(last_result IN ('success','failed') OR last_result IS NULL),
                last_error      TEXT,
                run_count       INTEGER NOT NULL DEFAULT 0,
                claimed_at      TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cron_jobs_agent ON cron_jobs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
            CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at);
            ",
        )?;
    }

    let has_cron_runs: bool = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cron_runs'")?
        .query_map([], |row| {
            let name: String = row.get(0)?;
            Ok(name)
        })?
        .filter_map(|r| r.ok())
        .any(|_| true);

    if !has_cron_runs {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS cron_runs (
                id              TEXT PRIMARY KEY,
                job_id          TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
                agent_id        TEXT NOT NULL,
                status          TEXT NOT NULL CHECK(status IN ('running','success','failed')) DEFAULT 'running',
                prompt          TEXT NOT NULL,
                result_summary  TEXT,
                error           TEXT,
                started_at      TEXT NOT NULL,
                finished_at     TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id);
            ",
        )?;
    }

    // ── Ensure claimed_at column exists on cron_jobs (upgrade path) ──
    if has_cron_jobs {
        let cj_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(cron_jobs)")?
            .query_map([], |row| {
                let name: String = row.get(1)?;
                Ok(name)
            })?
            .filter_map(|r| r.ok())
            .collect();

        if !cj_columns.contains(&"claimed_at".to_string()) {
            conn.execute_batch(
                "ALTER TABLE cron_jobs ADD COLUMN claimed_at TEXT;"
            )?;
        }
    }

    Ok(())
}

/// Ensure the database has the current schema.
/// Creates all tables and records the schema version.
pub fn ensure_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    create_schema(conn)?;
    run_incremental_migrations(conn)?;
    set_schema_version(conn)?;
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
    fn test_ensure_schema_creates_tables() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"agents".to_string()));
        assert!(tables.contains(&"conversations".to_string()));
        assert!(tables.contains(&"messages".to_string()));
        assert!(tables.contains(&"tool_call_logs".to_string()));
        assert!(tables.contains(&"browser_artifacts".to_string()));
        assert!(tables.contains(&"contacts".to_string()));
        assert!(tables.contains(&"peer_threads".to_string()));
        assert!(tables.contains(&"peer_messages".to_string()));
        assert!(tables.contains(&"outbox".to_string()));
        assert!(tables.contains(&"_schema_version".to_string()));
    }

    #[test]
    fn test_ensure_schema_is_idempotent() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();
        ensure_schema(&conn).unwrap(); // should not error

        let version = get_schema_version(&conn).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn test_schema_version_recorded() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();

        let version = get_schema_version(&conn).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn test_conversations_has_agent_id() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO agents (id, folder_name, name, description, created_at, updated_at) VALUES ('a1', 'test', 'Test', '', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES ('c1', 'Test', 'a1', '2024-01-01', '2024-01-01')",
            [],
        ).unwrap();

        let agent_id: String = conn
            .query_row("SELECT agent_id FROM conversations WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(agent_id, "a1");
    }

    #[test]
    fn test_foreign_keys_cascade() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();

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

        // Cascade delete: agent → conversations → messages
        conn.execute("DELETE FROM agents WHERE id = 'a1'", []).unwrap();

        let conv_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(conv_count, 0);

        let msg_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(msg_count, 0);
    }

    #[test]
    fn test_relay_tables_cascade() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();

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
        assert_eq!(count, 0);
    }

    #[test]
    fn test_schema_version_mismatch_detected() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();

        // Simulate a version mismatch
        conn.execute("UPDATE _schema_version SET version = 999", []).unwrap();
        let version = get_schema_version(&conn).unwrap();
        assert_ne!(version, SCHEMA_VERSION);
    }

    #[test]
    fn test_incremental_migration_idempotent() {
        let conn = setup_conn();
        ensure_schema(&conn).unwrap();

        // Running incremental migrations again should not error
        run_incremental_migrations(&conn).unwrap();
        run_incremental_migrations(&conn).unwrap();

        // Verify learning_mode column exists
        let has_col: bool = conn
            .prepare("PRAGMA table_info(conversations)")
            .unwrap()
            .query_map([], |row| {
                let name: String = row.get(1)?;
                Ok(name)
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .any(|name| name == "learning_mode");
        assert!(has_col, "learning_mode column should exist after migration");
    }

    #[test]
    fn test_incremental_migration_adds_missing_column() {
        let conn = setup_conn();
        // Create schema without learning_mode (simulate old DB)
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                folder_name TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                summary TEXT,
                summary_up_to_message_id TEXT,
                active_skills TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tool_call_logs (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                tool_input TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );"
        ).unwrap();

        // Run incremental migration — should add the column
        run_incremental_migrations(&conn).unwrap();

        // Verify column was added
        let has_col: bool = conn
            .prepare("PRAGMA table_info(conversations)")
            .unwrap()
            .query_map([], |row| {
                let name: String = row.get(1)?;
                Ok(name)
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .any(|name| name == "learning_mode");
        assert!(has_col, "learning_mode column should be added by migration");
    }
}
