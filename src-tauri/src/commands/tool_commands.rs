use crate::db::models::{self, ToolExecution};
use crate::tools;
use crate::tools::permissions::check_permission;
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

/// Map a tool name to its corresponding permission type.
/// Keys must match what PermissionSettings.tsx saves to DB:
/// file_read, file_write, shell_execute, browser, network
fn tool_to_permission_type(tool_name: &str) -> &str {
    match tool_name {
        "file_read" => "file_read",
        "file_write" => "file_write",
        "shell_execute" | "program_execute" => "shell_execute",
        "browser_navigate" | "browser_screenshot" | "browser_click" | "browser_type" => "browser",
        "web_search" | "web_fetch" => "network",
        // SaaS tools also go through network permission
        "notion_search" | "notion_get_page" | "notion_create_page" | "notion_list_pages"
        | "jira_search" | "jira_get_issue" | "jira_create_issue" | "confluence_search"
        | "confluence_get_page" => "network",
        _ => "unknown",
    }
}

/// Check if a file path is within the agent's folder whitelist.
/// Returns true if the whitelist is empty (no restrictions) or the path is under a whitelisted folder.
fn is_path_whitelisted(
    conn: &rusqlite::Connection,
    agent_id: &str,
    file_path: &str,
) -> Result<bool, String> {
    let whitelist =
        models::get_folder_whitelist(conn, agent_id).map_err(|e| e.to_string())?;
    // If no whitelist entries, allow all paths (no restrictions configured)
    if whitelist.is_empty() {
        return Ok(true);
    }
    let normalized = std::path::Path::new(file_path);
    for entry in &whitelist {
        let allowed = std::path::Path::new(&entry.path);
        if normalized.starts_with(allowed) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Check if a program is in the agent's program whitelist.
/// Returns true if the whitelist is empty (no restrictions) or the program is whitelisted.
fn is_program_whitelisted(
    conn: &rusqlite::Connection,
    agent_id: &str,
    program: &str,
) -> Result<bool, String> {
    let whitelist =
        models::get_program_whitelist(conn, agent_id).map_err(|e| e.to_string())?;
    // If no whitelist entries, allow all programs (no restrictions configured)
    if whitelist.is_empty() {
        return Ok(true);
    }
    for entry in &whitelist {
        if entry.program == program {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn execute_tool(
    state: State<'_, AppState>,
    request: ExecuteToolRequest,
) -> Result<Value, String> {
    // ── Permission check ──
    {
        let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
        let permission_type = tool_to_permission_type(&request.tool_name);

        let level = check_permission(&conn, &request.agent_id, permission_type)
            .map_err(|e| e.to_string())?;

        match level.as_str() {
            "none" => {
                return Err(format!(
                    "Permission denied: agent '{}' does not have '{}' permission to execute tool '{}'",
                    request.agent_id, permission_type, request.tool_name
                ));
            }
            "ask" => {
                // "ask" level: allow execution but log for audit.
                // A proper approval UI can be added later.
                eprintln!(
                    "[permission:ask] agent '{}' executing tool '{}' (permission_type: '{}')",
                    request.agent_id, request.tool_name, permission_type
                );
            }
            "auto" | "always" => {
                // Permission granted, proceed
            }
            _ => {
                // Unknown permission level, treat as denied for safety
                return Err(format!(
                    "Permission denied: unknown permission level '{}' for agent '{}'",
                    level, request.agent_id
                ));
            }
        }

        // Additional whitelist checks for file tools
        if request.tool_name == "file_read" || request.tool_name == "file_write" {
            if let Some(path) = request.params.get("path").and_then(|v| v.as_str()) {
                if !is_path_whitelisted(&conn, &request.agent_id, path)? {
                    return Err(format!(
                        "Permission denied: path '{}' is not in agent '{}' folder whitelist",
                        path, request.agent_id
                    ));
                }
            }
        }

        // Additional whitelist check for program execution
        if request.tool_name == "program_execute" {
            if let Some(program) = request.params.get("program").and_then(|v| v.as_str()) {
                if !is_program_whitelisted(&conn, &request.agent_id, program)? {
                    return Err(format!(
                        "Permission denied: program '{}' is not in agent '{}' program whitelist",
                        program, request.agent_id
                    ));
                }
            }
        }
    }

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
    let result = tools::execute_tool(&request.tool_name, request.params).await;

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
