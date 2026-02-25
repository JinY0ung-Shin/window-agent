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

// ── Helper ──

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}
