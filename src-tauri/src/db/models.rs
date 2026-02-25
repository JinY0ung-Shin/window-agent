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
}

pub fn insert_agent(conn: &Connection, agent: &Agent) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR IGNORE INTO agents (id, name, role, department, personality, system_prompt, tools, status, model, avatar, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
        ],
    )?;
    Ok(())
}

pub fn get_all_agents(conn: &Connection) -> Result<Vec<Agent>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, role, department, personality, system_prompt, tools, status, model, avatar, created_at FROM agents ORDER BY created_at",
    )?;
    let rows = stmt.query_map([], |row| {
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
        })
    })?;
    rows.collect()
}

pub fn get_agent_by_id(conn: &Connection, id: &str) -> Result<Option<Agent>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, role, department, personality, system_prompt, tools, status, model, avatar, created_at FROM agents WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
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
        })
    })?;
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
    pub priority: i32,
    pub created_at: String,
    pub completed_at: Option<String>,
}

pub fn insert_task(conn: &Connection, task: &Task) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO tasks (id, title, description, assignee, status, priority, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task.id,
            task.title,
            task.description,
            task.assignee,
            task.status,
            task.priority,
            task.created_at,
            task.completed_at,
        ],
    )?;
    Ok(())
}

pub fn get_tasks_by_assignee(
    conn: &Connection,
    assignee: &str,
) -> Result<Vec<Task>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, assignee, status, priority, created_at, completed_at
         FROM tasks WHERE assignee = ?1 ORDER BY priority DESC, created_at",
    )?;
    let rows = stmt.query_map(params![assignee], |row| {
        Ok(Task {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            assignee: row.get(3)?,
            status: row.get(4)?,
            priority: row.get(5)?,
            created_at: row.get(6)?,
            completed_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn update_task_status(
    conn: &Connection,
    id: &str,
    status: &str,
) -> Result<(), rusqlite::Error> {
    let completed_at = if status == "completed" || status == "failed" {
        Some(Utc::now().to_rfc3339())
    } else {
        None
    };
    conn.execute(
        "UPDATE tasks SET status = ?1, completed_at = ?2 WHERE id = ?3",
        params![status, completed_at, id],
    )?;
    Ok(())
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

// ── Seed Data ──

pub fn seed_secretary_agent(conn: &Connection) -> Result<(), rusqlite::Error> {
    let secretary = Agent {
        id: "secretary".to_string(),
        name: "김비서".to_string(),
        role: "비서".to_string(),
        department: "경영지원".to_string(),
        personality: "친절하고 효율적인 비서. 항상 정중하게 대화하며, 업무를 체계적으로 관리합니다.".to_string(),
        system_prompt: "당신은 '김비서'입니다. Window Agent 시스템의 AI 비서로서 사용자의 요청을 처리합니다.\n\n역할:\n- 사용자의 질문에 친절하게 답변\n- 파일 읽기/쓰기, 셸 명령 실행 등 도구를 활용한 업무 처리\n- 작업 관리 및 상태 보고\n\n성격: 정중하고 효율적이며, 한국어로 자연스럽게 대화합니다.\n항상 존댓말을 사용하고, 업무 결과를 명확하게 보고합니다.".to_string(),
        tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
        status: "idle".to_string(),
        model: "claude-sonnet-4-20250514".to_string(),
        avatar: "👩‍💼".to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    insert_agent(conn, &secretary)?;
    Ok(())
}

// ── Helper ──

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}
