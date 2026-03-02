use crate::db::models::{self, FolderWhitelistEntry, Permission, ProgramWhitelistEntry};
use crate::AppState;
use chrono::Utc;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn get_permissions(
    state: State<AppState>,
    agent_id: String,
) -> Result<Vec<Permission>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_permissions(&conn, &agent_id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_permission(
    state: State<AppState>,
    agent_id: String,
    permission_type: String,
    level: String,
) -> Result<Permission, String> {
    let perm = Permission {
        id: models::new_id(),
        agent_id,
        permission_type,
        level,
    };
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::upsert_permission(&conn, &perm).map_err(|e| e.to_string())?;
    Ok(perm)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_folder_whitelist(
    state: State<AppState>,
    agent_id: String,
) -> Result<Vec<FolderWhitelistEntry>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_folder_whitelist(&conn, &agent_id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn add_folder_to_whitelist(
    state: State<AppState>,
    agent_id: String,
    path: String,
) -> Result<FolderWhitelistEntry, String> {
    let entry = FolderWhitelistEntry {
        id: models::new_id(),
        agent_id,
        path,
        created_at: Utc::now().to_rfc3339(),
    };
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::add_folder_whitelist(&conn, &entry).map_err(|e| e.to_string())?;
    Ok(entry)
}

#[tauri::command(rename_all = "snake_case")]
pub fn remove_folder_from_whitelist(
    state: State<AppState>,
    id: String,
) -> Result<bool, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::remove_folder_whitelist(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_program_whitelist(
    state: State<AppState>,
    agent_id: String,
) -> Result<Vec<ProgramWhitelistEntry>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_program_whitelist(&conn, &agent_id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn add_program_to_whitelist(
    state: State<AppState>,
    agent_id: String,
    program: String,
) -> Result<ProgramWhitelistEntry, String> {
    let entry = ProgramWhitelistEntry {
        id: models::new_id(),
        agent_id,
        program,
        created_at: Utc::now().to_rfc3339(),
    };
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::add_program_whitelist(&conn, &entry).map_err(|e| e.to_string())?;
    Ok(entry)
}

#[tauri::command(rename_all = "snake_case")]
pub fn remove_program_from_whitelist(
    state: State<AppState>,
    id: String,
) -> Result<bool, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::remove_program_whitelist(&conn, &id).map_err(|e| e.to_string())
}
