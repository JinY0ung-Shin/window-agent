use crate::db::models::{self, ToolExecution};
use crate::tools;
use crate::AppState;
use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ExecuteToolRequest {
    pub agent_id: String,
    pub tool_name: String,
    pub params: Value,
    pub task_id: Option<String>,
}

#[tauri::command]
pub fn execute_tool(
    state: State<AppState>,
    request: ExecuteToolRequest,
) -> Result<Value, String> {
    let exec_id = models::new_id();
    let now = Utc::now().to_rfc3339();

    // Record the execution as running
    let exec = ToolExecution {
        id: exec_id.clone(),
        agent_id: request.agent_id,
        tool_name: request.tool_name.clone(),
        params: serde_json::to_string(&request.params).unwrap_or_default(),
        result: String::new(),
        status: "running".to_string(),
        timestamp: now,
        task_id: request.task_id,
    };
    {
        let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
        models::insert_tool_execution(&conn, &exec).map_err(|e| e.to_string())?;
    }

    // Execute the tool
    let result = tools::execute_tool(&request.tool_name, request.params);

    // Determine status from result
    let success = result
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let status = if success { "success" } else { "error" };

    // Update execution record
    {
        let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
        let result_str = serde_json::to_string(&result).unwrap_or_default();
        models::update_tool_execution_result(&conn, &exec_id, &result_str, status)
            .map_err(|e| e.to_string())?;
    }

    Ok(result)
}
