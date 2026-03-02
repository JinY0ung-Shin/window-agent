use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Agent ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub department: String,
    pub personality: String,
    pub system_prompt: String,
    pub tools: String,       // JSON array string
    pub status: String,      // idle | working | error
    pub model: String,
    pub avatar: String,
    pub created_at: String,
    #[serde(default = "default_ai_backend")]
    pub ai_backend: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_url: String,
    #[serde(default = "default_is_active")]
    pub is_active: bool,
    #[serde(default)]
    pub hired_at: Option<String>,
    #[serde(default)]
    pub fired_at: Option<String>,
}

fn default_ai_backend() -> String {
    "claude".to_string()
}

fn default_is_active() -> bool {
    true
}

/// Public-facing Agent struct that excludes sensitive fields (api_key).
/// Used when returning agent data to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPublic {
    pub id: String,
    pub name: String,
    pub role: String,
    pub department: String,
    pub personality: String,
    pub system_prompt: String,
    pub tools: String,
    pub status: String,
    pub model: String,
    pub avatar: String,
    pub created_at: String,
    pub ai_backend: String,
    pub api_url: String,
    pub is_active: bool,
    pub hired_at: Option<String>,
    pub fired_at: Option<String>,
}

impl Agent {
    /// Convert to a public DTO that excludes the api_key field.
    pub fn to_public(&self) -> AgentPublic {
        AgentPublic {
            id: self.id.clone(),
            name: self.name.clone(),
            role: self.role.clone(),
            department: self.department.clone(),
            personality: self.personality.clone(),
            system_prompt: self.system_prompt.clone(),
            tools: self.tools.clone(),
            status: self.status.clone(),
            model: self.model.clone(),
            avatar: self.avatar.clone(),
            created_at: self.created_at.clone(),
            ai_backend: self.ai_backend.clone(),
            api_url: self.api_url.clone(),
            is_active: self.is_active,
            hired_at: self.hired_at.clone(),
            fired_at: self.fired_at.clone(),
        }
    }
}

pub fn insert_agent(conn: &Connection, agent: &Agent) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR IGNORE INTO agents (id, name, role, department, personality, system_prompt, tools, status, model, avatar, created_at, ai_backend, api_key, api_url, is_active, hired_at, fired_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            agent.id,
            agent.name,
            agent.role,
            agent.department,
            agent.personality,
            agent.system_prompt,
            agent.tools,
            agent.status,
            agent.model,
            agent.avatar,
            agent.created_at,
            agent.ai_backend,
            agent.api_key,
            agent.api_url,
            agent.is_active as i32,
            agent.hired_at,
            agent.fired_at,
        ],
    )?;
    Ok(())
}

const AGENT_SELECT: &str = "SELECT id, name, role, department, personality, system_prompt, tools, status, model, avatar, created_at, ai_backend, api_key, api_url, is_active, hired_at, fired_at FROM agents";

fn row_to_agent(row: &rusqlite::Row) -> Result<Agent, rusqlite::Error> {
    Ok(Agent {
        id: row.get(0)?,
        name: row.get(1)?,
        role: row.get(2)?,
        department: row.get(3)?,
        personality: row.get(4)?,
        system_prompt: row.get(5)?,
        tools: row.get(6)?,
        status: row.get(7)?,
        model: row.get(8)?,
        avatar: row.get(9)?,
        created_at: row.get(10)?,
        ai_backend: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "claude".to_string()),
        api_key: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        api_url: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
        is_active: row.get::<_, Option<i32>>(14)?.unwrap_or(1) != 0,
        hired_at: row.get(15)?,
        fired_at: row.get(16)?,
    })
}

pub fn get_all_agents(conn: &Connection) -> Result<Vec<Agent>, rusqlite::Error> {
    let sql = format!("{} ORDER BY created_at", AGENT_SELECT);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row_to_agent(row))?;
    rows.collect()
}

pub fn get_active_agents(conn: &Connection) -> Result<Vec<Agent>, rusqlite::Error> {
    let sql = format!("{} WHERE is_active = 1 ORDER BY created_at", AGENT_SELECT);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row_to_agent(row))?;
    rows.collect()
}

pub fn get_agent_by_id(conn: &Connection, id: &str) -> Result<Option<Agent>, rusqlite::Error> {
    let sql = format!("{} WHERE id = ?1", AGENT_SELECT);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], |row| row_to_agent(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn update_agent_status(
    conn: &Connection,
    id: &str,
    status: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE agents SET status = ?1 WHERE id = ?2",
        params![status, id],
    )?;
    Ok(())
}

pub fn update_agent(conn: &Connection, agent: &Agent) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE agents SET name=?1, role=?2, department=?3, personality=?4, system_prompt=?5, tools=?6, model=?7, avatar=?8, ai_backend=?9, api_key=?10, api_url=?11, is_active=?12, fired_at=?13 WHERE id=?14",
        params![
            agent.name,
            agent.role,
            agent.department,
            agent.personality,
            agent.system_prompt,
            agent.tools,
            agent.model,
            agent.avatar,
            agent.ai_backend,
            agent.api_key,
            agent.api_url,
            agent.is_active as i32,
            agent.fired_at,
            agent.id,
        ],
    )?;
    Ok(())
}

pub fn fire_agent(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE agents SET is_active = 0, fired_at = ?1, status = 'idle' WHERE id = ?2",
        params![now, id],
    )?;
    Ok(rows > 0)
}

// ── Message ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub channel: String,
    pub sender: String,
    pub content: String,
    pub timestamp: String,
    pub metadata: String, // JSON string
}

pub fn insert_message(conn: &Connection, msg: &Message) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO messages (id, channel, sender, content, timestamp, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            msg.id,
            msg.channel,
            msg.sender,
            msg.content,
            msg.timestamp,
            msg.metadata,
        ],
    )?;
    Ok(())
}

pub fn get_messages_by_channel(
    conn: &Connection,
    channel: &str,
    limit: i64,
) -> Result<Vec<Message>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, channel, sender, content, timestamp, metadata
         FROM messages WHERE channel = ?1
         ORDER BY timestamp ASC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![channel, limit], |row| {
        Ok(Message {
            id: row.get(0)?,
            channel: row.get(1)?,
            sender: row.get(2)?,
            content: row.get(3)?,
            timestamp: row.get(4)?,
            metadata: row.get(5)?,
        })
    })?;
    rows.collect()
}

// ── Task ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub assignee: Option<String>,
    pub status: String, // pending | in_progress | completed | failed
    pub priority: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub parent_task_id: Option<String>,
    #[serde(default)]
    pub creator: Option<String>,
}

pub fn insert_task(conn: &Connection, task: &Task) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO tasks (id, title, description, assignee, status, priority, created_at, completed_at, updated_at, parent_task_id, creator)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            task.id,
            task.title,
            task.description,
            task.assignee,
            task.status,
            task.priority,
            task.created_at,
            task.completed_at,
            task.updated_at,
            task.parent_task_id,
            task.creator,
        ],
    )?;
    Ok(())
}

pub fn get_all_tasks(conn: &Connection) -> Result<Vec<Task>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, assignee, status, priority, created_at, completed_at, updated_at, parent_task_id, creator
         FROM tasks ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| row_to_task(row))?;
    rows.collect()
}

pub fn get_tasks_by_assignee(
    conn: &Connection,
    assignee: &str,
) -> Result<Vec<Task>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, assignee, status, priority, created_at, completed_at, updated_at, parent_task_id, creator
         FROM tasks WHERE assignee = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![assignee], |row| row_to_task(row))?;
    rows.collect()
}

pub fn get_tasks_by_status(
    conn: &Connection,
    status: &str,
) -> Result<Vec<Task>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, assignee, status, priority, created_at, completed_at, updated_at, parent_task_id, creator
         FROM tasks WHERE status = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![status], |row| row_to_task(row))?;
    rows.collect()
}

pub fn get_task_by_id(conn: &Connection, id: &str) -> Result<Option<Task>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, assignee, status, priority, created_at, completed_at, updated_at, parent_task_id, creator
         FROM tasks WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| row_to_task(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

fn row_to_task(row: &rusqlite::Row) -> Result<Task, rusqlite::Error> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        assignee: row.get(3)?,
        status: row.get(4)?,
        priority: row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "medium".to_string()),
        created_at: row.get(6)?,
        completed_at: row.get(7)?,
        updated_at: row.get(8)?,
        parent_task_id: row.get(9)?,
        creator: row.get(10)?,
    })
}

pub fn update_task(conn: &Connection, task: &Task) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET title=?1, description=?2, assignee=?3, status=?4, priority=?5, completed_at=?6, updated_at=?7, parent_task_id=?8, creator=?9 WHERE id=?10",
        params![
            task.title,
            task.description,
            task.assignee,
            task.status,
            task.priority,
            task.completed_at,
            now,
            task.parent_task_id,
            task.creator,
            task.id,
        ],
    )?;
    Ok(())
}

pub fn update_task_status(
    conn: &Connection,
    id: &str,
    status: &str,
) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    let completed_at = if status == "completed" || status == "failed" {
        Some(now.clone())
    } else {
        None
    };
    conn.execute(
        "UPDATE tasks SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![status, completed_at, now, id],
    )?;
    Ok(())
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ── ToolExecution ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecution {
    pub id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub params: String,  // JSON string
    pub result: String,
    pub status: String,  // pending | running | success | error
    pub timestamp: String,
    pub task_id: Option<String>,
}

pub fn insert_tool_execution(
    conn: &Connection,
    exec: &ToolExecution,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO tool_executions (id, agent_id, tool_name, params, result, status, timestamp, task_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            exec.id,
            exec.agent_id,
            exec.tool_name,
            exec.params,
            exec.result,
            exec.status,
            exec.timestamp,
            exec.task_id,
        ],
    )?;
    Ok(())
}

pub fn update_tool_execution_result(
    conn: &Connection,
    id: &str,
    result: &str,
    status: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE tool_executions SET result = ?1, status = ?2 WHERE id = ?3",
        params![result, status, id],
    )?;
    Ok(())
}

// ── Department ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Department {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
}

pub fn insert_department(conn: &Connection, dept: &Department) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR IGNORE INTO departments (id, name, description, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![dept.id, dept.name, dept.description, dept.created_at],
    )?;
    Ok(())
}

pub fn get_all_departments(conn: &Connection) -> Result<Vec<Department>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at FROM departments ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Department {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

// ── Permission ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    pub id: String,
    pub agent_id: String,
    pub permission_type: String,
    pub level: String, // none | ask | auto
}

pub fn get_permissions(conn: &Connection, agent_id: &str) -> Result<Vec<Permission>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, permission_type, level FROM permissions WHERE agent_id = ?1",
    )?;
    let rows = stmt.query_map(params![agent_id], |row| {
        Ok(Permission {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            permission_type: row.get(2)?,
            level: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_permission(conn: &Connection, perm: &Permission) -> Result<(), rusqlite::Error> {
    // Try to update first
    let rows = conn.execute(
        "UPDATE permissions SET level = ?1 WHERE agent_id = ?2 AND permission_type = ?3",
        params![perm.level, perm.agent_id, perm.permission_type],
    )?;
    if rows == 0 {
        conn.execute(
            "INSERT INTO permissions (id, agent_id, permission_type, level) VALUES (?1, ?2, ?3, ?4)",
            params![perm.id, perm.agent_id, perm.permission_type, perm.level],
        )?;
    }
    Ok(())
}

// ── FolderWhitelist ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderWhitelistEntry {
    pub id: String,
    pub agent_id: String,
    pub path: String,
    pub created_at: String,
}

pub fn get_folder_whitelist(conn: &Connection, agent_id: &str) -> Result<Vec<FolderWhitelistEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, path, created_at FROM folder_whitelist WHERE agent_id = ?1 ORDER BY path",
    )?;
    let rows = stmt.query_map(params![agent_id], |row| {
        Ok(FolderWhitelistEntry {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            path: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn add_folder_whitelist(conn: &Connection, entry: &FolderWhitelistEntry) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO folder_whitelist (id, agent_id, path, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![entry.id, entry.agent_id, entry.path, entry.created_at],
    )?;
    Ok(())
}

pub fn remove_folder_whitelist(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM folder_whitelist WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ── ProgramWhitelist ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgramWhitelistEntry {
    pub id: String,
    pub agent_id: String,
    pub program: String,
    pub created_at: String,
}

pub fn get_program_whitelist(conn: &Connection, agent_id: &str) -> Result<Vec<ProgramWhitelistEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, program, created_at FROM program_whitelist WHERE agent_id = ?1 ORDER BY program",
    )?;
    let rows = stmt.query_map(params![agent_id], |row| {
        Ok(ProgramWhitelistEntry {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            program: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn add_program_whitelist(conn: &Connection, entry: &ProgramWhitelistEntry) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO program_whitelist (id, agent_id, program, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![entry.id, entry.agent_id, entry.program, entry.created_at],
    )?;
    Ok(())
}

pub fn remove_program_whitelist(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM program_whitelist WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ── AgentMessage ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub from_agent: String,
    pub to_agent: String,
    pub content: String,
    pub timestamp: String,
    pub read: bool,
}

pub fn insert_agent_message(conn: &Connection, msg: &AgentMessage) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO agent_messages (id, from_agent, to_agent, content, timestamp, read) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![msg.id, msg.from_agent, msg.to_agent, msg.content, msg.timestamp, msg.read as i32],
    )?;
    Ok(())
}

pub fn get_agent_messages(conn: &Connection, agent_id: &str) -> Result<Vec<AgentMessage>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, from_agent, to_agent, content, timestamp, read FROM agent_messages WHERE to_agent = ?1 OR from_agent = ?1 ORDER BY timestamp ASC",
    )?;
    let rows = stmt.query_map(params![agent_id], |row| {
        Ok(AgentMessage {
            id: row.get(0)?,
            from_agent: row.get(1)?,
            to_agent: row.get(2)?,
            content: row.get(3)?,
            timestamp: row.get(4)?,
            read: row.get::<_, i32>(5)? != 0,
        })
    })?;
    rows.collect()
}

// ── Seed Data ──

pub fn seed_secretary_agent(conn: &Connection) -> Result<(), rusqlite::Error> {
    let secretary = Agent {
        id: "secretary".to_string(),
        name: "\u{ae40}\u{be44}\u{c11c}".to_string(),
        role: "\u{be44}\u{c11c}".to_string(),
        department: "\u{acbd}\u{c601}\u{c9c0}\u{c6d0}".to_string(),
        personality: "\u{ce5c}\u{c808}\u{d558}\u{ace0} \u{d6a8}\u{c728}\u{c801}\u{c778} \u{be44}\u{c11c}. \u{d56d}\u{c0c1} \u{c815}\u{c911}\u{d558}\u{ac8c} \u{b300}\u{d654}\u{d558}\u{ba70}, \u{c5c5}\u{bb34}\u{b97c} \u{ccb4}\u{acc4}\u{c801}\u{c73c}\u{b85c} \u{ad00}\u{b9ac}\u{d569}\u{b2c8}\u{b2e4}.".to_string(),
        system_prompt: "\u{b2f9}\u{c2e0}\u{c740} '\u{ae40}\u{be44}\u{c11c}'\u{c785}\u{b2c8}\u{b2e4}. Window Agent \u{c2dc}\u{c2a4}\u{d15c}\u{c758} AI \u{be44}\u{c11c}\u{b85c}\u{c11c} \u{c0ac}\u{c6a9}\u{c790}\u{c758} \u{c694}\u{ccad}\u{c744} \u{cc98}\u{b9ac}\u{d569}\u{b2c8}\u{b2e4}.\n\n\u{c5ed}\u{d560}:\n- \u{c0ac}\u{c6a9}\u{c790}\u{c758} \u{c9c8}\u{bb38}\u{c5d0} \u{ce5c}\u{c808}\u{d558}\u{ac8c} \u{b2f5}\u{bcc0}\n- \u{d30c}\u{c77c} \u{c77d}\u{ae30}/\u{c4f0}\u{ae30}, \u{c178} \u{ba85}\u{b839} \u{c2e4}\u{d589} \u{b4f1} \u{b3c4}\u{ad6c}\u{b97c} \u{d65c}\u{c6a9}\u{d55c} \u{c5c5}\u{bb34} \u{cc98}\u{b9ac}\n- \u{c791}\u{c5c5} \u{ad00}\u{b9ac} \u{bc0f} \u{c0c1}\u{d0dc} \u{bcf4}\u{ace0}\n\n\u{c131}\u{acbd}: \u{c815}\u{c911}\u{d558}\u{ace0} \u{d6a8}\u{c728}\u{c801}\u{c774}\u{ba70}, \u{d55c}\u{ad6d}\u{c5b4}\u{b85c} \u{c790}\u{c5f0}\u{c2a4}\u{b7fd}\u{ac8c} \u{b300}\u{d654}\u{d569}\u{b2c8}\u{b2e4}.\n\u{d56d}\u{c0c1} \u{c874}\u{b313}\u{b9d0}\u{c744} \u{c0ac}\u{c6a9}\u{d558}\u{ace0}, \u{c5c5}\u{bb34} \u{acb0}\u{acfc}\u{b97c} \u{ba85}\u{d655}\u{d558}\u{ac8c} \u{bcf4}\u{ace0}\u{d569}\u{b2c8}\u{b2e4}.".to_string(),
        tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
        status: "idle".to_string(),
        model: "claude-sonnet-4-20250514".to_string(),
        avatar: "\u{1f469}\u{200d}\u{1f4bc}".to_string(),
        created_at: Utc::now().to_rfc3339(),
        ai_backend: "claude".to_string(),
        api_key: String::new(),
        api_url: String::new(),
        is_active: true,
        hired_at: Some(Utc::now().to_rfc3339()),
        fired_at: None,
    };
    insert_agent(conn, &secretary)?;
    Ok(())
}

// ── ScheduledTask ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub cron_expression: String,
    pub assignee: Option<String>,
    pub priority: String,
    pub is_active: bool,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub created_at: String,
}

const SCHEDULED_TASK_SELECT: &str = "SELECT id, title, description, cron_expression, assignee, priority, is_active, last_run_at, next_run_at, created_at FROM scheduled_tasks";

fn row_to_scheduled_task(row: &rusqlite::Row) -> Result<ScheduledTask, rusqlite::Error> {
    Ok(ScheduledTask {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        cron_expression: row.get(3)?,
        assignee: row.get(4)?,
        priority: row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "medium".to_string()),
        is_active: row.get::<_, i32>(6)? != 0,
        last_run_at: row.get(7)?,
        next_run_at: row.get(8)?,
        created_at: row.get(9)?,
    })
}

pub fn insert_scheduled_task(conn: &Connection, task: &ScheduledTask) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO scheduled_tasks (id, title, description, cron_expression, assignee, priority, is_active, last_run_at, next_run_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            task.id,
            task.title,
            task.description,
            task.cron_expression,
            task.assignee,
            task.priority,
            task.is_active as i32,
            task.last_run_at,
            task.next_run_at,
            task.created_at,
        ],
    )?;
    Ok(())
}

pub fn get_scheduled_tasks(conn: &Connection, active_only: bool) -> Result<Vec<ScheduledTask>, rusqlite::Error> {
    let sql = if active_only {
        format!("{} WHERE is_active = 1 ORDER BY created_at DESC", SCHEDULED_TASK_SELECT)
    } else {
        format!("{} ORDER BY created_at DESC", SCHEDULED_TASK_SELECT)
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row_to_scheduled_task(row))?;
    rows.collect()
}

pub fn get_scheduled_task_by_id(conn: &Connection, id: &str) -> Result<Option<ScheduledTask>, rusqlite::Error> {
    let sql = format!("{} WHERE id = ?1", SCHEDULED_TASK_SELECT);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], |row| row_to_scheduled_task(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn update_scheduled_task(conn: &Connection, task: &ScheduledTask) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE scheduled_tasks SET title=?1, description=?2, cron_expression=?3, assignee=?4, priority=?5, is_active=?6, last_run_at=?7, next_run_at=?8 WHERE id=?9",
        params![
            task.title,
            task.description,
            task.cron_expression,
            task.assignee,
            task.priority,
            task.is_active as i32,
            task.last_run_at,
            task.next_run_at,
            task.id,
        ],
    )?;
    Ok(())
}

pub fn delete_scheduled_task(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM scheduled_tasks WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn get_due_scheduled_tasks(conn: &Connection, now: &str) -> Result<Vec<ScheduledTask>, rusqlite::Error> {
    let sql = format!("{} WHERE is_active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1", SCHEDULED_TASK_SELECT);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![now], |row| row_to_scheduled_task(row))?;
    rows.collect()
}

pub fn update_scheduled_task_run(conn: &Connection, id: &str, last_run_at: &str, next_run_at: Option<&str>) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE scheduled_tasks SET last_run_at = ?1, next_run_at = ?2 WHERE id = ?3",
        params![last_run_at, next_run_at, id],
    )?;
    Ok(())
}

// ── OrgChart ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgChartNode {
    pub department: Department,
    pub agents: Vec<Agent>,
}

// ── AgentBackup ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBackup {
    pub id: String,
    pub agent_id: String,
    pub config_json: String,
    pub reason: String,
    pub backed_up_at: String,
    pub restored_at: Option<String>,
}

pub fn insert_agent_backup(conn: &Connection, backup: &AgentBackup) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO agent_backups (id, agent_id, config_json, reason, backed_up_at, restored_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![backup.id, backup.agent_id, backup.config_json, backup.reason, backup.backed_up_at, backup.restored_at],
    )?;
    Ok(())
}

pub fn get_agent_backups(conn: &Connection, agent_id: Option<&str>) -> Result<Vec<AgentBackup>, rusqlite::Error> {
    match agent_id {
        Some(aid) => {
            let mut stmt = conn.prepare(
                "SELECT id, agent_id, config_json, reason, backed_up_at, restored_at FROM agent_backups WHERE agent_id = ?1 ORDER BY backed_up_at DESC",
            )?;
            let rows = stmt.query_map(params![aid], |row| {
                Ok(AgentBackup {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    config_json: row.get(2)?,
                    reason: row.get(3)?,
                    backed_up_at: row.get(4)?,
                    restored_at: row.get(5)?,
                })
            })?;
            rows.collect()
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, agent_id, config_json, reason, backed_up_at, restored_at FROM agent_backups ORDER BY backed_up_at DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(AgentBackup {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    config_json: row.get(2)?,
                    reason: row.get(3)?,
                    backed_up_at: row.get(4)?,
                    restored_at: row.get(5)?,
                })
            })?;
            rows.collect()
        }
    }
}

pub fn get_backup_by_id(conn: &Connection, id: &str) -> Result<Option<AgentBackup>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, config_json, reason, backed_up_at, restored_at FROM agent_backups WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(AgentBackup {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            config_json: row.get(2)?,
            reason: row.get(3)?,
            backed_up_at: row.get(4)?,
            restored_at: row.get(5)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn mark_backup_restored(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE agent_backups SET restored_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn update_agent_department(conn: &Connection, agent_id: &str, new_department: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE agents SET department = ?1 WHERE id = ?2",
        params![new_department, agent_id],
    )?;
    Ok(())
}

pub fn update_department(conn: &Connection, dept_id: &str, name: Option<&str>, description: Option<&str>) -> Result<Department, rusqlite::Error> {
    if let Some(name) = name {
        conn.execute(
            "UPDATE departments SET name = ?1 WHERE id = ?2",
            params![name, dept_id],
        )?;
    }
    if let Some(description) = description {
        conn.execute(
            "UPDATE departments SET description = ?1 WHERE id = ?2",
            params![description, dept_id],
        )?;
    }
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at FROM departments WHERE id = ?1",
    )?;
    let dept = stmt.query_row(params![dept_id], |row| {
        Ok(Department {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    Ok(dept)
}

pub fn delete_department(conn: &Connection, dept_id: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM departments WHERE id = ?1", params![dept_id])?;
    Ok(rows > 0)
}

// ── Report ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub report_type: String,
    pub title: String,
    pub content: String,
    pub generated_at: String,
    pub period_start: String,
    pub period_end: String,
    pub metadata: String,
}

pub fn insert_report(conn: &Connection, report: &Report) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO reports (id, report_type, title, content, generated_at, period_start, period_end, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            report.id,
            report.report_type,
            report.title,
            report.content,
            report.generated_at,
            report.period_start,
            report.period_end,
            report.metadata,
        ],
    )?;
    Ok(())
}

pub fn get_reports(
    conn: &Connection,
    report_type: Option<&str>,
    limit: i64,
) -> Result<Vec<Report>, rusqlite::Error> {
    let (sql, use_type) = match report_type {
        Some(_) => (
            "SELECT id, report_type, title, content, generated_at, period_start, period_end, metadata
             FROM reports WHERE report_type = ?1 ORDER BY generated_at DESC LIMIT ?2",
            true,
        ),
        None => (
            "SELECT id, report_type, title, content, generated_at, period_start, period_end, metadata
             FROM reports ORDER BY generated_at DESC LIMIT ?1",
            false,
        ),
    };
    let mut stmt = conn.prepare(sql)?;
    let results: Vec<Report> = if use_type {
        let rows = stmt.query_map(params![report_type.unwrap(), limit], |row| row_to_report(row))?;
        rows.collect::<Result<Vec<_>, _>>()?
    } else {
        let rows = stmt.query_map(params![limit], |row| row_to_report(row))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    Ok(results)
}

pub fn get_report_by_id(conn: &Connection, id: &str) -> Result<Option<Report>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, report_type, title, content, generated_at, period_start, period_end, metadata
         FROM reports WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| row_to_report(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn delete_report(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM reports WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

fn row_to_report(row: &rusqlite::Row) -> Result<Report, rusqlite::Error> {
    Ok(Report {
        id: row.get(0)?,
        report_type: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        generated_at: row.get(4)?,
        period_start: row.get(5)?,
        period_end: row.get(6)?,
        metadata: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "{}".to_string()),
    })
}

// ── Evaluation ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub id: String,
    pub agent_id: String,
    pub period: String,
    pub task_success_rate: f64,
    pub avg_completion_time_secs: f64,
    pub total_tasks: i32,
    pub completed_tasks: i32,
    pub failed_tasks: i32,
    pub total_cost_usd: f64,
    pub score: f64,
    pub evaluation_notes: String,
    pub created_at: String,
}

pub fn insert_evaluation(conn: &Connection, eval: &Evaluation) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO evaluations (id, agent_id, period, task_success_rate, avg_completion_time_secs, total_tasks, completed_tasks, failed_tasks, total_cost_usd, score, evaluation_notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            eval.id,
            eval.agent_id,
            eval.period,
            eval.task_success_rate,
            eval.avg_completion_time_secs,
            eval.total_tasks,
            eval.completed_tasks,
            eval.failed_tasks,
            eval.total_cost_usd,
            eval.score,
            eval.evaluation_notes,
            eval.created_at,
        ],
    )?;
    Ok(())
}

pub fn get_evaluations(
    conn: &Connection,
    agent_id: Option<&str>,
    limit: i64,
) -> Result<Vec<Evaluation>, rusqlite::Error> {
    let (sql, use_agent) = match agent_id {
        Some(_) => (
            "SELECT id, agent_id, period, task_success_rate, avg_completion_time_secs, total_tasks, completed_tasks, failed_tasks, total_cost_usd, score, evaluation_notes, created_at
             FROM evaluations WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT ?2",
            true,
        ),
        None => (
            "SELECT id, agent_id, period, task_success_rate, avg_completion_time_secs, total_tasks, completed_tasks, failed_tasks, total_cost_usd, score, evaluation_notes, created_at
             FROM evaluations ORDER BY created_at DESC LIMIT ?1",
            false,
        ),
    };
    let mut stmt = conn.prepare(sql)?;
    let results: Vec<Evaluation> = if use_agent {
        let rows = stmt.query_map(params![agent_id.unwrap(), limit], |row| row_to_evaluation(row))?;
        rows.collect::<Result<Vec<_>, _>>()?
    } else {
        let rows = stmt.query_map(params![limit], |row| row_to_evaluation(row))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    Ok(results)
}

fn row_to_evaluation(row: &rusqlite::Row) -> Result<Evaluation, rusqlite::Error> {
    Ok(Evaluation {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        period: row.get(2)?,
        task_success_rate: row.get(3)?,
        avg_completion_time_secs: row.get(4)?,
        total_tasks: row.get(5)?,
        completed_tasks: row.get(6)?,
        failed_tasks: row.get(7)?,
        total_cost_usd: row.get(8)?,
        score: row.get(9)?,
        evaluation_notes: row.get(10)?,
        created_at: row.get(11)?,
    })
}

// ── PerformanceSummary ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSummary {
    pub agent_id: String,
    pub task_success_rate: f64,
    pub avg_time_secs: f64,
    pub total_tasks: i32,
    pub total_cost: f64,
    pub score: f64,
    pub trend: String,
}

pub fn get_agent_performance_summary(
    conn: &Connection,
    agent_id: &str,
) -> Result<PerformanceSummary, rusqlite::Error> {
    let total_tasks: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE assignee = ?1",
            params![agent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let completed_tasks: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE assignee = ?1 AND status = 'completed'",
            params![agent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let success_rate = if total_tasks > 0 {
        completed_tasks as f64 / total_tasks as f64 * 100.0
    } else {
        0.0
    };

    let avg_time: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(
                (julianday(completed_at) - julianday(created_at)) * 86400
             ), 0.0)
             FROM tasks
             WHERE assignee = ?1 AND status = 'completed' AND completed_at IS NOT NULL",
            params![agent_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    let total_cost: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM cost_records WHERE agent_id = ?1",
            params![agent_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    let speed_score = if avg_time > 0.0 {
        (3600.0 / avg_time).min(1.0)
    } else {
        0.5
    };
    let score = (success_rate / 100.0 * 0.6 + speed_score * 0.4) * 100.0;

    let trend = match conn.prepare(
        "SELECT score FROM evaluations WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT 2",
    ) {
        Ok(mut stmt) => {
            let scores: Vec<f64> = stmt
                .query_map(params![agent_id], |row| row.get::<_, f64>(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            if scores.len() >= 2 {
                if scores[0] > scores[1] + 5.0 {
                    "up".to_string()
                } else if scores[0] < scores[1] - 5.0 {
                    "down".to_string()
                } else {
                    "stable".to_string()
                }
            } else {
                "stable".to_string()
            }
        }
        Err(_) => "stable".to_string(),
    };

    Ok(PerformanceSummary {
        agent_id: agent_id.to_string(),
        task_success_rate: success_rate,
        avg_time_secs: avg_time,
        total_tasks,
        total_cost,
        score,
        trend,
    })
}

// ── CostRecord ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostRecord {
    pub id: String,
    pub agent_id: String,
    pub tool_execution_id: Option<String>,
    pub model: String,
    pub tokens_input: i64,
    pub tokens_output: i64,
    pub cost_usd: f64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostSummary {
    pub total_cost: f64,
    pub total_tokens: i64,
    pub by_agent: Vec<AgentCostBreakdown>,
    pub by_model: Vec<ModelCostBreakdown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCostBreakdown {
    pub agent_id: String,
    pub agent_name: String,
    pub cost_usd: f64,
    pub tokens: i64,
    pub call_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCostBreakdown {
    pub model: String,
    pub cost_usd: f64,
    pub tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyCost {
    pub date: String,
    pub cost_usd: f64,
    pub tokens: i64,
}

pub fn insert_cost_record(conn: &Connection, record: &CostRecord) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO cost_records (id, agent_id, tool_execution_id, model, tokens_input, tokens_output, cost_usd, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.id,
            record.agent_id,
            record.tool_execution_id,
            record.model,
            record.tokens_input,
            record.tokens_output,
            record.cost_usd,
            record.timestamp,
        ],
    )?;
    Ok(())
}

pub fn get_cost_summary(
    conn: &Connection,
    period_start: Option<&str>,
    period_end: Option<&str>,
) -> Result<CostSummary, rusqlite::Error> {
    let (where_clause, param_values) = build_cost_period_clause(period_start, period_end);

    // Total cost and tokens
    let total_sql = format!(
        "SELECT COALESCE(SUM(cost_usd), 0.0), COALESCE(SUM(tokens_input + tokens_output), 0) FROM cost_records{}",
        where_clause
    );
    let (total_cost, total_tokens): (f64, i64) = {
        let refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
        conn.query_row(&total_sql, refs.as_slice(), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
    };

    // By agent (JOIN agents for name)
    let agent_where = where_clause.replace(" timestamp", " c.timestamp");
    let agent_sql = format!(
        "SELECT c.agent_id, COALESCE(a.name, c.agent_id), COALESCE(SUM(c.cost_usd), 0.0), \
         COALESCE(SUM(c.tokens_input + c.tokens_output), 0), COUNT(*) \
         FROM cost_records c LEFT JOIN agents a ON c.agent_id = a.id{} \
         GROUP BY c.agent_id ORDER BY SUM(c.cost_usd) DESC",
        agent_where
    );
    let by_agent = {
        let refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
        let mut stmt = conn.prepare(&agent_sql)?;
        let rows = stmt.query_map(refs.as_slice(), |row| {
            Ok(AgentCostBreakdown {
                agent_id: row.get(0)?,
                agent_name: row.get(1)?,
                cost_usd: row.get(2)?,
                tokens: row.get(3)?,
                call_count: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    // By model
    let model_sql = format!(
        "SELECT model, COALESCE(SUM(cost_usd), 0.0), COALESCE(SUM(tokens_input + tokens_output), 0) \
         FROM cost_records{} GROUP BY model ORDER BY SUM(cost_usd) DESC",
        where_clause
    );
    let by_model = {
        let refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
        let mut stmt = conn.prepare(&model_sql)?;
        let rows = stmt.query_map(refs.as_slice(), |row| {
            Ok(ModelCostBreakdown {
                model: row.get(0)?,
                cost_usd: row.get(1)?,
                tokens: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    Ok(CostSummary {
        total_cost,
        total_tokens,
        by_agent,
        by_model,
    })
}

pub fn get_agent_cost_history(
    conn: &Connection,
    agent_id: &str,
    limit: i64,
) -> Result<Vec<CostRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, tool_execution_id, model, tokens_input, tokens_output, cost_usd, timestamp \
         FROM cost_records WHERE agent_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![agent_id, limit], |row| {
        Ok(CostRecord {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            tool_execution_id: row.get(2)?,
            model: row.get(3)?,
            tokens_input: row.get(4)?,
            tokens_output: row.get(5)?,
            cost_usd: row.get(6)?,
            timestamp: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn get_cost_trend(
    conn: &Connection,
    days: i64,
) -> Result<Vec<DailyCost>, rusqlite::Error> {
    let offset = format!("-{} days", days);
    let mut stmt = conn.prepare(
        "SELECT date(timestamp) as d, COALESCE(SUM(cost_usd), 0.0), COALESCE(SUM(tokens_input + tokens_output), 0) \
         FROM cost_records WHERE timestamp >= datetime('now', ?1) GROUP BY d ORDER BY d",
    )?;
    let rows = stmt.query_map(params![offset], |row| {
        Ok(DailyCost {
            date: row.get(0)?,
            cost_usd: row.get(1)?,
            tokens: row.get(2)?,
        })
    })?;
    rows.collect()
}

fn build_cost_period_clause(start: Option<&str>, end: Option<&str>) -> (String, Vec<String>) {
    let mut clauses = Vec::new();
    let mut vals = Vec::new();
    if let Some(s) = start {
        clauses.push("timestamp >= ?".to_string());
        vals.push(s.to_string());
    }
    if let Some(e) = end {
        clauses.push("timestamp <= ?".to_string());
        vals.push(e.to_string());
    }
    let wc = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    (wc, vals)
}

// ── Helper ──

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}
