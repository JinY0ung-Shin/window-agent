use crate::db::models::BrowserArtifact;
use crate::db::{operations, Database};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use super::dispatcher::{execute_tool_inner, execute_tool_inner_for_agent};

pub(crate) const TOOL_TIMEOUT: Duration = Duration::from_secs(30);
const BROWSER_TOOL_TIMEOUT: Duration = Duration::from_secs(360); // 6 min: allows for Chromium install on first run
const COMMAND_TOOL_TIMEOUT: Duration = Duration::from_secs(310); // 300s user max + 10s buffer for cleanup

/// Result returned by execute_tool to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecutionResult {
    pub tool_call_log_id: String,
    pub status: String,
    pub output: String,
    pub duration_ms: i64,
}

// ── Dispatcher ──

/// Execute a single tool call, log it, and return the result.
#[tauri::command]
pub async fn execute_tool(
    app: AppHandle,
    db: State<'_, Database>,
    tool_name: String,
    tool_input: String,
    conversation_id: String,
) -> Result<ToolExecutionResult, AppError> {
    // Parse input JSON
    let input: serde_json::Value = serde_json::from_str(&tool_input)
        .map_err(|e| AppError::Validation(format!("Invalid tool_input JSON: {}", e)))?;

    // Create pending log entry
    let log_entry = operations::create_tool_call_log_impl(
        &db,
        conversation_id.clone(),
        None,
        tool_name.clone(),
        tool_input,
    )?;

    let start = Instant::now();

    // Custom timeouts for specific tools
    let tool_timeout = if tool_name.starts_with("browser_") {
        BROWSER_TOOL_TIMEOUT
    } else if tool_name == "run_shell" {
        COMMAND_TOOL_TIMEOUT
    } else {
        TOOL_TIMEOUT
    };

    // Execute the tool with timeout
    let result = match timeout(
        tool_timeout,
        execute_tool_inner(&app, &db, &tool_name, &input, &conversation_id),
    )
    .await
    {
        Ok(inner_result) => inner_result,
        Err(_) => Err(format!(
            "Tool '{}' timed out after {} seconds",
            tool_name,
            tool_timeout.as_secs()
        )),
    };

    let duration_ms = start.elapsed().as_millis() as i64;

    // Determine status, output, and artifact_id
    let (status, output, artifact_id) = match result {
        Ok(value) => {
            let aid = value
                .get("artifact_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (
                "executed".to_string(),
                serde_json::to_string(&value).unwrap_or_default(),
                aid,
            )
        }
        Err(err) => (
            "error".to_string(),
            serde_json::json!({ "error": err }).to_string(),
            None,
        ),
    };

    // Update the log entry
    let _ = operations::update_tool_call_log_status_impl(
        &db,
        log_entry.id.clone(),
        status.clone(),
        Some(output.clone()),
        Some(duration_ms),
        artifact_id,
    );

    Ok(ToolExecutionResult {
        tool_call_log_id: log_entry.id,
        status,
        output,
        duration_ms,
    })
}

/// Public entry point for backend-triggered tool execution (e.g., cron jobs).
/// Accepts `agent_id` directly instead of `conversation_id` since background
/// tasks don't have a conversation context. Creates a synthetic conversation_id
/// so that scope resolution (file tools) can resolve the agent's persona dir.
///
/// All tools are auto-approved — no user confirmation is possible in backend context.
pub async fn execute_tool_inner_public(
    app: &AppHandle,
    db: &Database,
    tool_name: &str,
    input: &serde_json::Value,
    agent_id: &str,
) -> Result<serde_json::Value, String> {
    // For backend execution, we use agent_id as a synthetic conversation_id.
    // The resolve_scope function will look up the conversation, which won't exist,
    // so we need to handle scope differently for cron.
    // For now, pass agent_id and handle the "no conversation" case gracefully.
    let timeout_secs = match tool_name {
        t if t.starts_with("browser_") => 360,
        "run_shell" => 310,
        _ => 30,
    };
    let duration = std::time::Duration::from_secs(timeout_secs);

    match tokio::time::timeout(
        duration,
        execute_tool_inner_for_agent(app, db, tool_name, input, agent_id),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(format!(
            "Tool '{}' timed out after {}s",
            tool_name, timeout_secs
        )),
    }
}


/// Approve a domain for browser access in a conversation's session.
/// Called by the frontend when user confirms a browser navigation.
#[tauri::command]
pub async fn approve_browser_domain(
    app: AppHandle,
    conversation_id: String,
    domain: String,
) -> Result<(), AppError> {
    let browser = app.state::<crate::browser::BrowserManager>();
    browser
        .approve_domain(&conversation_id, &domain)
        .await
        .map_err(AppError::Validation)
}

/// Retrieve a stored browser artifact by ID.
#[tauri::command]
pub async fn get_browser_artifact(
    db: State<'_, Database>,
    id: String,
) -> Result<BrowserArtifact, AppError> {
    Ok(operations::get_browser_artifact(&db, &id)?)
}

/// Get the current browser headless setting.
#[tauri::command]
pub async fn get_browser_headless(app: AppHandle) -> Result<bool, AppError> {
    let browser = app.state::<crate::browser::BrowserManager>();
    Ok(browser.get_headless().await)
}

/// Set browser headless mode.
#[tauri::command]
pub async fn set_browser_headless(app: AppHandle, headless: bool) -> Result<(), AppError> {
    let browser = app.state::<crate::browser::BrowserManager>();
    browser.set_headless(headless).await;
    Ok(())
}

/// Get the current browser proxy server URL.
#[tauri::command]
pub async fn get_browser_proxy(app: AppHandle) -> Result<String, AppError> {
    let browser = app.state::<crate::browser::BrowserManager>();
    Ok(browser.get_proxy_server().await)
}

/// Set the browser proxy server URL.
#[tauri::command]
pub async fn set_browser_proxy(app: AppHandle, proxy: String) -> Result<(), AppError> {
    let browser = app.state::<crate::browser::BrowserManager>();
    browser.set_proxy_server(proxy).await;
    Ok(())
}

/// Get the current browser NO_PROXY bypass list.
#[tauri::command]
pub async fn get_browser_no_proxy(app: AppHandle) -> Result<String, AppError> {
    let browser = app.state::<crate::browser::BrowserManager>();
    Ok(browser.get_no_proxy().await)
}

/// Set the browser NO_PROXY bypass list.
#[tauri::command]
pub async fn set_browser_no_proxy(app: AppHandle, no_proxy: String) -> Result<(), AppError> {
    let browser = app.state::<crate::browser::BrowserManager>();
    browser.set_no_proxy(no_proxy).await;
    Ok(())
}

/// Detect system proxy settings and return the URL (or empty string).
#[tauri::command]
pub fn detect_system_proxy() -> Result<String, AppError> {
    Ok(crate::browser::detect_system_proxy().unwrap_or_default())
}

/// Detect system NO_PROXY settings and return the bypass list (or empty string).
#[tauri::command]
pub fn detect_system_no_proxy() -> Result<String, AppError> {
    Ok(crate::browser::detect_system_no_proxy().unwrap_or_default())
}

/// Get the resolved shell configuration for display in settings UI.
#[tauri::command]
pub fn get_shell_info() -> Result<serde_json::Value, AppError> {
    let info = super::shell_tools::get_shell_info();
    Ok(serde_json::json!({
        "program": info.program,
        "is_posix": info.is_posix,
        "shell_type": if info.is_posix { "posix (bash/sh)" } else { "cmd.exe" },
        "ssh_hardening": true,
    }))
}
