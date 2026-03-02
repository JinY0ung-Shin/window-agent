use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT '',
            department TEXT NOT NULL DEFAULT '',
            personality TEXT NOT NULL DEFAULT '',
            system_prompt TEXT NOT NULL DEFAULT '',
            tools TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'working', 'error')),
            model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
            avatar TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            channel TEXT NOT NULL DEFAULT 'general',
            sender TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            assignee TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
            priority TEXT NOT NULL DEFAULT 'medium',
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (assignee) REFERENCES agents(id)
        );

        CREATE TABLE IF NOT EXISTS tool_executions (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            params TEXT NOT NULL DEFAULT '{}',
            result TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'success', 'error')),
            timestamp TEXT NOT NULL,
            task_id TEXT,
            FOREIGN KEY (agent_id) REFERENCES agents(id),
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        );

        CREATE TABLE IF NOT EXISTS departments (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS task_dependencies (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            depends_on TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (depends_on) REFERENCES tasks(id)
        );

        CREATE TABLE IF NOT EXISTS permissions (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            permission_type TEXT NOT NULL,
            level TEXT NOT NULL DEFAULT 'ask' CHECK(level IN ('none', 'ask', 'auto')),
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );

        CREATE TABLE IF NOT EXISTS folder_whitelist (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );

        CREATE TABLE IF NOT EXISTS program_whitelist (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            program TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );

        CREATE TABLE IF NOT EXISTS agent_messages (
            id TEXT PRIMARY KEY,
            from_agent TEXT NOT NULL,
            to_agent TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            read INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (from_agent) REFERENCES agents(id),
            FOREIGN KEY (to_agent) REFERENCES agents(id)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tool_executions_agent ON tool_executions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_permissions_agent ON permissions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_folder_whitelist_agent ON folder_whitelist(agent_id);
        CREATE INDEX IF NOT EXISTS idx_program_whitelist_agent ON program_whitelist(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent);
        ",
    )?;

    // Migration: add new columns to existing tables (ignore errors if columns already exist)
    let migrations = [
        "ALTER TABLE agents ADD COLUMN ai_backend TEXT DEFAULT 'claude'",
        "ALTER TABLE agents ADD COLUMN api_key TEXT DEFAULT ''",
        "ALTER TABLE agents ADD COLUMN api_url TEXT DEFAULT ''",
        "ALTER TABLE agents ADD COLUMN is_active INTEGER DEFAULT 1",
        "ALTER TABLE agents ADD COLUMN hired_at TEXT",
        "ALTER TABLE agents ADD COLUMN fired_at TEXT",
        "ALTER TABLE tasks ADD COLUMN updated_at TEXT",
        "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT",
        "ALTER TABLE tasks ADD COLUMN creator TEXT",
    ];

    for migration in &migrations {
        // Ignore "duplicate column" errors
        let _ = conn.execute(migration, []);
    }

    // Phase 3 tables
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            report_type TEXT NOT NULL CHECK(report_type IN ('daily', 'weekly', 'monthly')),
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            generated_at TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS evaluations (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            period TEXT NOT NULL,
            task_success_rate REAL NOT NULL DEFAULT 0.0,
            avg_completion_time_secs REAL NOT NULL DEFAULT 0.0,
            total_tasks INTEGER NOT NULL DEFAULT 0,
            completed_tasks INTEGER NOT NULL DEFAULT 0,
            failed_tasks INTEGER NOT NULL DEFAULT 0,
            total_cost_usd REAL NOT NULL DEFAULT 0.0,
            score REAL NOT NULL DEFAULT 0.0,
            evaluation_notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );

        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            cron_expression TEXT NOT NULL,
            assignee TEXT,
            priority TEXT NOT NULL DEFAULT 'medium',
            is_active INTEGER NOT NULL DEFAULT 1,
            last_run_at TEXT,
            next_run_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (assignee) REFERENCES agents(id)
        );

        CREATE TABLE IF NOT EXISTS agent_backups (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            config_json TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            backed_up_at TEXT NOT NULL,
            restored_at TEXT
        );

        CREATE TABLE IF NOT EXISTS cost_records (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            tool_execution_id TEXT,
            model TEXT NOT NULL DEFAULT '',
            tokens_input INTEGER NOT NULL DEFAULT 0,
            tokens_output INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0.0,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );

        CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type);
        CREATE INDEX IF NOT EXISTS idx_evaluations_agent ON evaluations(agent_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_active ON scheduled_tasks(is_active);
        CREATE INDEX IF NOT EXISTS idx_cost_records_agent ON cost_records(agent_id);
        CREATE INDEX IF NOT EXISTS idx_cost_records_timestamp ON cost_records(timestamp);
        ",
    )?;

    // Phase 3 agent column migrations
    let phase3_migrations = [
        "ALTER TABLE agents ADD COLUMN on_leave INTEGER DEFAULT 0",
        "ALTER TABLE agents ADD COLUMN leave_started_at TEXT",
        "ALTER TABLE agents ADD COLUMN leave_reason TEXT DEFAULT ''",
    ];

    for migration in &phase3_migrations {
        let _ = conn.execute(migration, []);
    }

    Ok(())
}
