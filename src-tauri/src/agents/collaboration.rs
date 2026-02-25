use chrono::Utc;
use rusqlite::Connection;

use crate::db::models::{self, AgentMessage};

pub fn send_message(
    conn: &Connection,
    from_agent: &str,
    to_agent: &str,
    content: &str,
) -> Result<AgentMessage, rusqlite::Error> {
    let msg = AgentMessage {
        id: models::new_id(),
        from_agent: from_agent.to_string(),
        to_agent: to_agent.to_string(),
        content: content.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        read: false,
    };
    models::insert_agent_message(conn, &msg)?;
    Ok(msg)
}

pub fn get_messages_for_agent(
    conn: &Connection,
    agent_id: &str,
) -> Result<Vec<AgentMessage>, rusqlite::Error> {
    models::get_agent_messages(conn, agent_id)
}
