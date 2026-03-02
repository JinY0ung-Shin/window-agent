use crate::agents::collaboration;
use crate::db::models::AgentMessage;
use crate::AppState;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn send_agent_message(
    state: State<AppState>,
    from_agent: String,
    to_agent: String,
    content: String,
) -> Result<AgentMessage, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    collaboration::send_message(&conn, &from_agent, &to_agent, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_agent_messages(
    state: State<AppState>,
    agent_id: String,
) -> Result<Vec<AgentMessage>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    collaboration::get_messages_for_agent(&conn, &agent_id).map_err(|e| e.to_string())
}
