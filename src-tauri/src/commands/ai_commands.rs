use crate::agents::runner::AgentRunner;
use crate::ai::types::ChatMessage;
use crate::db::models;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub success: bool,
    pub message: Option<String>,
    pub error: Option<String>,
}

/// Streaming chat command. Sends user message to the specified agent,
/// streams the response via "chat-stream" events, and saves messages to DB.
#[tauri::command(rename_all = "snake_case")]
pub async fn chat_with_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    message: String,
) -> Result<ChatResponse, String> {
    // Load agent from DB
    let agent = {
        let conn = state
            .db
            .conn
            .lock()
            .map_err(|e| format!("DB lock error: {}", e))?;
        models::get_agent_by_id(&conn, &agent_id)
            .map_err(|e| format!("DB error: {}", e))?
            .ok_or_else(|| format!("Agent not found: {}", agent_id))?
    };

    // Create runner from agent config
    let runner = AgentRunner::from_agent(&agent)
        .map_err(|e| format!("Failed to create agent runner: {}", e))?;

    // Save user message to DB
    {
        let conn = state
            .db
            .conn
            .lock()
            .map_err(|e| format!("DB lock error: {}", e))?;
        let msg_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO messages (id, channel, sender, content, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![msg_id, agent_id, "user", message, now],
        )
        .map_err(|e| format!("Failed to save user message: {}", e))?;
    }

    // Load conversation history from DB for context
    let history = {
        let conn = state
            .db
            .conn
            .lock()
            .map_err(|e| format!("DB lock error: {}", e))?;
        let mut stmt = conn
            .prepare(
                "SELECT sender, content FROM messages WHERE channel = ?1 ORDER BY timestamp ASC LIMIT 50",
            )
            .map_err(|e| format!("DB query error: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![agent_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })
            .map_err(|e| format!("DB query error: {}", e))?;

        let mut msgs = Vec::new();
        for row in rows {
            if let Ok((sender, content)) = row {
                let role = if sender == "user" {
                    "user"
                } else {
                    "assistant"
                };
                msgs.push(ChatMessage {
                    role: role.to_string(),
                    content,
                });
            }
        }
        msgs
    };

    let result = runner.handle_message_streaming(history, app).await;

    match result {
        Ok(full_response) => {
            // Save assistant response to DB
            let conn = state
                .db
                .conn
                .lock()
                .map_err(|e| format!("DB lock error: {}", e))?;
            let msg_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO messages (id, channel, sender, content, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![msg_id, agent_id, "assistant", full_response, now],
            )
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

            // Record estimated cost
            let tokens_input = (message.len() as i64) / 4;
            let tokens_output = (full_response.len() as i64) / 4;
            let cost_per_1k_input = match agent.model.as_str() {
                m if m.contains("opus") => 0.015,
                m if m.contains("sonnet") => 0.003,
                m if m.contains("haiku") => 0.00025,
                m if m.contains("gpt-4") => 0.01,
                m if m.contains("gpt-3") => 0.0005,
                _ => 0.003, // default to sonnet-level pricing
            };
            let cost_per_1k_output = cost_per_1k_input * 5.0;
            let cost_usd = (tokens_input as f64 / 1000.0) * cost_per_1k_input
                + (tokens_output as f64 / 1000.0) * cost_per_1k_output;

            let cost_record = models::CostRecord {
                id: uuid::Uuid::new_v4().to_string(),
                agent_id: agent_id.clone(),
                tool_execution_id: None,
                model: agent.model.clone(),
                tokens_input,
                tokens_output,
                cost_usd,
                timestamp: now,
            };
            let _ = models::insert_cost_record(&conn, &cost_record);

            Ok(ChatResponse {
                success: true,
                message: Some(full_response),
                error: None,
            })
        }
        Err(e) => Ok(ChatResponse {
            success: false,
            message: None,
            error: Some(e.to_string()),
        }),
    }
}
