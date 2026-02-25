use crate::agents::secretary::{SecretaryAgent, SECRETARY_AGENT_ID};
use crate::ai::types::ChatMessage;
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
#[tauri::command]
pub async fn chat_with_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    message: String,
) -> Result<ChatResponse, String> {
    // Get API key and URL from environment
    let api_key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| {
        "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.".to_string()
    })?;
    let api_url = std::env::var("ANTHROPIC_API_URL")
        .unwrap_or_else(|_| "https://api.anthropic.com/v1/messages".to_string());
    let model = std::env::var("ANTHROPIC_MODEL")
        .unwrap_or_else(|_| "claude-sonnet-4-20250514".to_string());

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

    // Route to the appropriate agent
    let result = match agent_id.as_str() {
        SECRETARY_AGENT_ID => {
            let agent = SecretaryAgent::new(api_key, api_url, model);
            agent.handle_message_streaming(history, app).await
        }
        _ => {
            return Err(format!("Unknown agent: {}", agent_id));
        }
    };

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
