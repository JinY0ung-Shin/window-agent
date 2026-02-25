use crate::db::models::{self, Agent};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_agents(state: State<AppState>) -> Result<Vec<Agent>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_all_agents(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_agent_status(state: State<AppState>, agent_id: String) -> Result<Agent, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_agent_by_id(&conn, &agent_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent not found: {}", agent_id))
}
