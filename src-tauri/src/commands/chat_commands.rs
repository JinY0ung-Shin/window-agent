use crate::db::models::{self, Message};
use crate::AppState;
use chrono::Utc;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub channel: String,
    pub sender: String,
    pub content: String,
    #[serde(default)]
    pub metadata: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub fn send_message(
    state: State<AppState>,
    request: SendMessageRequest,
) -> Result<Message, String> {
    let msg = Message {
        id: models::new_id(),
        channel: request.channel,
        sender: request.sender,
        content: request.content,
        timestamp: Utc::now().to_rfc3339(),
        metadata: request.metadata.unwrap_or_else(|| "{}".to_string()),
    };
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::insert_message(&conn, &msg).map_err(|e| e.to_string())?;
    Ok(msg)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_messages(
    state: State<AppState>,
    channel: String,
    limit: Option<i64>,
) -> Result<Vec<Message>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(100);
    models::get_messages_by_channel(&conn, &channel, limit).map_err(|e| e.to_string())
}
