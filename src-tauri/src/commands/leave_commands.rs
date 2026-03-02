use crate::db::models::{self, AgentBackup};
use crate::AppState;
use chrono::Utc;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn put_agent_on_leave(
    state: State<AppState>,
    agent_id: String,
    reason: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    // Backup agent config before leave
    let agent = models::get_agent_by_id(&conn, &agent_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

    let config_json = serde_json::to_string(&agent).map_err(|e| e.to_string())?;
    let backup = AgentBackup {
        id: models::new_id(),
        agent_id: agent_id.clone(),
        config_json,
        reason: format!("휴직: {}", reason),
        backed_up_at: now.clone(),
        restored_at: None,
    };
    models::insert_agent_backup(&conn, &backup).map_err(|e| e.to_string())?;

    // Set agent on leave
    conn.execute(
        "UPDATE agents SET on_leave = 1, leave_started_at = ?1, leave_reason = ?2, status = 'idle' WHERE id = ?3",
        rusqlite::params![now, reason, agent_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn restore_agent_from_leave(
    state: State<AppState>,
    agent_id: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE agents SET on_leave = 0, leave_started_at = NULL, leave_reason = '' WHERE id = ?1",
        rusqlite::params![agent_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn backup_agent_config(
    state: State<AppState>,
    agent_id: String,
    reason: String,
) -> Result<AgentBackup, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    let agent = models::get_agent_by_id(&conn, &agent_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

    let config_json = serde_json::to_string(&agent).map_err(|e| e.to_string())?;
    let backup = AgentBackup {
        id: models::new_id(),
        agent_id,
        config_json,
        reason,
        backed_up_at: Utc::now().to_rfc3339(),
        restored_at: None,
    };
    models::insert_agent_backup(&conn, &backup).map_err(|e| e.to_string())?;
    Ok(backup)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_agent_backups(
    state: State<AppState>,
    agent_id: Option<String>,
) -> Result<Vec<AgentBackup>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_agent_backups(&conn, agent_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn rehire_from_backup(
    state: State<AppState>,
    backup_id: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    let backup = models::get_backup_by_id(&conn, &backup_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Backup not found: {}", backup_id))?;

    let mut agent: models::Agent = serde_json::from_str(&backup.config_json)
        .map_err(|e| e.to_string())?;

    // Create as new agent with new id
    agent.id = models::new_id();
    agent.is_active = true;
    agent.fired_at = None;
    agent.status = "idle".to_string();
    agent.hired_at = Some(Utc::now().to_rfc3339());

    models::insert_agent(&conn, &agent).map_err(|e| e.to_string())?;
    models::mark_backup_restored(&conn, &backup_id).map_err(|e| e.to_string())?;

    Ok(())
}
