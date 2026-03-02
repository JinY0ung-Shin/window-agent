use crate::db::models::{self, AgentPublic};
use crate::AppState;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn get_agents(state: State<AppState>) -> Result<Vec<AgentPublic>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    let agents = models::get_all_agents(&conn).map_err(|e| e.to_string())?;
    Ok(agents.into_iter().map(|a| a.to_public()).collect())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_agent_status(state: State<AppState>, agent_id: String) -> Result<AgentPublic, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    let agent = models::get_agent_by_id(&conn, &agent_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;
    Ok(agent.to_public())
}
