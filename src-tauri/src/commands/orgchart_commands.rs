use crate::db::models::{self, OrgChartNode, Department};
use crate::AppState;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn get_org_chart(state: State<AppState>) -> Result<Vec<OrgChartNode>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    let departments = models::get_all_departments(&conn).map_err(|e| e.to_string())?;
    let agents = models::get_all_agents(&conn).map_err(|e| e.to_string())?;

    let nodes: Vec<OrgChartNode> = departments
        .into_iter()
        .map(|dept| {
            let dept_agents = agents
                .iter()
                .filter(|a| a.department == dept.name && a.is_active)
                .cloned()
                .collect();
            OrgChartNode {
                department: dept,
                agents: dept_agents,
            }
        })
        .collect();

    Ok(nodes)
}

#[tauri::command(rename_all = "snake_case")]
pub fn move_agent_department(
    state: State<AppState>,
    agent_id: String,
    new_department: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::update_agent_department(&conn, &agent_id, &new_department)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_department(
    state: State<AppState>,
    dept_id: String,
    name: Option<String>,
    description: Option<String>,
) -> Result<Department, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::update_department(&conn, &dept_id, name.as_deref(), description.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_department(
    state: State<AppState>,
    dept_id: String,
) -> Result<bool, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::delete_department(&conn, &dept_id).map_err(|e| e.to_string())
}
