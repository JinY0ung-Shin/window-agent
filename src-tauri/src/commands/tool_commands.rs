use crate::commands::vault_commands::VaultState;
use crate::db::models::BrowserArtifact;
use crate::db::{agent_operations, operations};
use crate::db::Database;
use crate::error::AppError;
use crate::services::credential_service;
use crate::utils::path_security::{validate_no_traversal, validate_tool_roots};
use crate::vault::strip_title_heading;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

const TOOL_TIMEOUT: Duration = Duration::from_secs(30);

// ── Native tool definitions & config commands ──

#[derive(Debug, Clone, Serialize)]
pub struct NativeToolDef {
    pub name: String,
    pub description: String,
    pub category: String,
    pub default_tier: String,
    pub parameters: serde_json::Value,
}

/// Returns all 14 native tool definitions with full schemas.
#[tauri::command]
pub fn get_native_tools() -> Result<Vec<NativeToolDef>, String> {
    Ok(native_tool_definitions())
}

/// Generates default TOOL_CONFIG.json from native tool definitions (all enabled, default tiers).
#[tauri::command]
pub fn get_default_tool_config() -> Result<String, String> {
    let defs = native_tool_definitions();
    let mut native = serde_json::Map::new();
    for def in &defs {
        native.insert(
            def.name.clone(),
            serde_json::json!({ "enabled": true, "tier": def.default_tier }),
        );
    }
    let config = serde_json::json!({ "version": 2, "auto_approve": false, "native": native, "credentials": {} });
    serde_json::to_string_pretty(&config).map_err(|e| format!("JSON serialization error: {}", e))
}

/// Read TOOL_CONFIG.json for an agent, normalizing on the fly.
#[tauri::command]
pub fn read_tool_config(app: AppHandle, folder_name: String) -> Result<String, String> {
    validate_no_traversal(&folder_name, "folder name")?;
    let agents_dir = get_agents_dir_for_tools(&app)?;
    let config_path = agents_dir.join(&folder_name).join("TOOL_CONFIG.json");
    let raw = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read TOOL_CONFIG.json: {}", e))?;

    let (normalized, changed) = normalize_tool_config(&raw)?;
    if changed {
        // Lazy write-back
        let _ = std::fs::write(&config_path, &normalized);
    }
    Ok(normalized)
}

/// Write TOOL_CONFIG.json for an agent.
#[tauri::command]
pub fn write_tool_config(
    app: AppHandle,
    folder_name: String,
    config: String,
) -> Result<(), String> {
    validate_no_traversal(&folder_name, "folder name")?;

    // Validate that the config is valid JSON
    serde_json::from_str::<serde_json::Value>(&config)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let agents_dir = get_agents_dir_for_tools(&app)?;
    let agent_dir = agents_dir.join(&folder_name);
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Failed to create agent directory: {}", e))?;

    let config_path = agent_dir.join("TOOL_CONFIG.json");
    std::fs::write(&config_path, &config)
        .map_err(|e| format!("Failed to write TOOL_CONFIG.json: {}", e))
}

fn get_agents_dir_for_tools(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_dir.join("agents"))
}

fn native_tool_definitions() -> Vec<NativeToolDef> {
    vec![
        NativeToolDef {
            name: "read_file".into(),
            description: "지정 경로의 파일 내용을 읽습니다".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "write_file".into(),
            description: "지정 경로에 파일을 씁니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"},"content":{"type":"string","description":"파일 내용"}},"required":["path","content"]}),
        },
        NativeToolDef {
            name: "list_directory".into(),
            description: "디렉토리 내 파일 목록을 조회합니다".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"디렉토리 경로"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "delete_file".into(),
            description: "지정 경로의 파일을 삭제합니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"삭제할 파일 경로"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "web_search".into(),
            description: "URL의 웹 페이지 내용을 가져옵니다".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"가져올 URL"}},"required":["url"]}),
        },
        NativeToolDef {
            name: "memory_note".into(),
            description: "에이전트의 메모리 노트를 관리합니다".into(),
            category: "memory".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"action":{"type":"string","description":"create | read | update | delete"},"id":{"type":"string","description":"노트 ID (update/delete 시 필요)"},"title":{"type":"string","description":"노트 제목"},"content":{"type":"string","description":"노트 내용"}},"required":["action","title"]}),
        },
        NativeToolDef {
            name: "browser_navigate".into(),
            description: "Navigate to a URL and return a snapshot of the page".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"The URL to navigate to"}},"required":["url"]}),
        },
        NativeToolDef {
            name: "browser_snapshot".into(),
            description: "Take a snapshot of the current page showing all interactive elements".into(),
            category: "browser".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "browser_click".into(),
            description: "Click an interactive element on the page by its reference number".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"ref":{"type":"number","description":"The reference number of the element to click"}},"required":["ref"]}),
        },
        NativeToolDef {
            name: "browser_type".into(),
            description: "Type text into an input field by its reference number".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"ref":{"type":"number","description":"The reference number of the input field"},"text":{"type":"string","description":"The text to type"}},"required":["ref","text"]}),
        },
        NativeToolDef {
            name: "browser_wait".into(),
            description: "Wait for a specified number of seconds then take a new snapshot".into(),
            category: "browser".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"seconds":{"type":"number","description":"Number of seconds to wait (default 2, max 10)"}}}),
        },
        NativeToolDef {
            name: "browser_back".into(),
            description: "Go back to the previous page in browser history".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "browser_close".into(),
            description: "Close the browser session for this conversation".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "http_request".into(),
            description: "Make HTTP requests. Use {{credential:ID}} in headers/body for authentication.".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "method": {
                        "type": "string",
                        "description": "HTTP method: GET, POST, PUT, DELETE, PATCH",
                        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"]
                    },
                    "url": {
                        "type": "string",
                        "description": "Request URL"
                    },
                    "headers": {
                        "type": "object",
                        "description": "Request headers as key-value pairs"
                    },
                    "body": {
                        "type": "string",
                        "description": "Request body"
                    },
                    "timeout_secs": {
                        "type": "number",
                        "description": "Request timeout in seconds (default 30, max 120)"
                    }
                },
                "required": ["url"]
            }),
        },
    ]
}

const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const BROWSER_TOOL_TIMEOUT: Duration = Duration::from_secs(360); // 6 min: allows for Chromium install on first run

/// Result returned by execute_tool to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecutionResult {
    pub tool_call_log_id: String,
    pub status: String,
    pub output: String,
    pub duration_ms: i64,
}

// ── Path security ──

/// Resolve and validate a path against allowed roots.
/// Delegates to utils::path_security::validate_tool_roots.
fn validate_path(raw_path: &str, allowed_roots: &[PathBuf]) -> Result<PathBuf, String> {
    validate_tool_roots(raw_path, allowed_roots)
}

/// Build the list of allowed root directories from the Tauri app handle.
fn allowed_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(app_dir) = app.path().app_data_dir() {
        roots.push(app_dir);
    }
    roots
}

// ── Workspace path resolution ──

/// Resolve the workspace path for a conversation's agent.
/// Returns `vault_path/agents/<agent_id>/workspace`, creating the directory if needed.
fn resolve_workspace_path(
    app: &AppHandle,
    db: &Database,
    conversation_id: &str,
) -> Result<PathBuf, String> {
    let conv = operations::get_conversation_detail_impl(db, conversation_id.to_string())
        .map_err(|e| format!("Failed to get conversation: {}", e))?;

    // Validate agent_id has no traversal characters
    validate_no_traversal(&conv.agent_id, "agent_id")?;

    let vault = app.state::<VaultState>();
    let vault_path = {
        let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
        vm.get_vault_path().to_path_buf()
    };

    let workspace = vault_path
        .join("agents")
        .join(&conv.agent_id)
        .join("workspace");

    std::fs::create_dir_all(&workspace)
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;

    // Canonicalize and verify the workspace is still inside the vault
    // (prevents symlink-based escapes)
    let canonical_workspace = std::fs::canonicalize(&workspace)
        .map_err(|e| format!("Cannot resolve workspace path: {}", e))?;
    let canonical_vault = std::fs::canonicalize(&vault_path)
        .map_err(|e| format!("Cannot resolve vault path: {}", e))?;

    if !canonical_workspace.starts_with(&canonical_vault) {
        return Err(format!(
            "Workspace path escapes vault boundary: {}",
            canonical_workspace.display()
        ));
    }

    Ok(canonical_workspace)
}

/// Tauri command: get the workspace path for a conversation.
#[tauri::command]
pub fn get_workspace_path(
    app: AppHandle,
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<String, String> {
    let ws = resolve_workspace_path(&app, &db, &conversation_id)?;
    Ok(ws.to_string_lossy().to_string())
}

// ── Individual tool implementations ──

fn tool_read_file(path: &str, allowed: &[PathBuf]) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    let content =
        std::fs::read_to_string(&validated).map_err(|e| format!("read_file failed: {}", e))?;
    Ok(serde_json::json!({ "content": content }))
}

fn tool_write_file(
    path: &str,
    content: &str,
    allowed: &[PathBuf],
) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;

    // Ensure parent directory exists
    if let Some(parent) = validated.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    std::fs::write(&validated, content).map_err(|e| format!("write_file failed: {}", e))?;
    Ok(serde_json::json!({ "success": true, "path": validated.to_string_lossy() }))
}

fn tool_delete_file(path: &str, allowed: &[PathBuf]) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    if !validated.is_file() {
        return Err(format!("delete_file: '{}' is not a file or does not exist", path));
    }
    std::fs::remove_file(&validated).map_err(|e| format!("delete_file failed: {}", e))?;
    Ok(serde_json::json!({ "success": true, "path": validated.to_string_lossy() }))
}

fn tool_list_directory(path: &str, allowed: &[PathBuf]) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    let entries: Vec<serde_json::Value> = std::fs::read_dir(&validated)
        .map_err(|e| format!("list_directory failed: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().ok()?.is_dir();
            Some(serde_json::json!({ "name": name, "is_dir": is_dir }))
        })
        .collect();
    Ok(serde_json::json!({ "entries": entries }))
}

async fn tool_web_search(input: &str) -> Result<serde_json::Value, String> {
    // If input doesn't look like a URL, treat it as a search query
    let url = if input.starts_with("http://") || input.starts_with("https://") {
        input.to_string()
    } else {
        format!(
            "https://html.duckduckgo.com/html/?q={}",
            urlencoding::encode(input)
        )
    };

    let client = reqwest::Client::builder()
        .timeout(TOOL_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    const MAX_BODY_BYTES: usize = 50_000;

    let resp = client
        .get(&url)
        .header("User-Agent", "WindowAgent/1.0")
        .send()
        .await
        .map_err(|e| format!("web_search request failed: {}", e))?;

    let status = resp.status().as_u16();

    // Reject obviously huge responses early via content-length
    if let Some(len) = resp.content_length() {
        if len > (MAX_BODY_BYTES as u64) * 2 {
            return Ok(serde_json::json!({
                "status": status,
                "body": format!("[Response too large: {} bytes, limit {}]", len, MAX_BODY_BYTES)
            }));
        }
    }

    // Stream body in chunks with a hard 50KB cap
    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut body = Vec::with_capacity(MAX_BODY_BYTES.min(65536));
    let mut truncated_flag = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e: reqwest::Error| format!("Failed to read response body: {}", e))?;
        let remaining = MAX_BODY_BYTES.saturating_sub(body.len());
        if remaining == 0 {
            truncated_flag = true;
            break;
        }
        let take = chunk.len().min(remaining);
        body.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            truncated_flag = true;
            break;
        }
    }

    let body_str = String::from_utf8_lossy(&body).to_string();
    let result = if truncated_flag {
        format!("{}... [truncated at {} bytes]", body_str, MAX_BODY_BYTES)
    } else {
        body_str
    };

    Ok(serde_json::json!({ "status": status, "body": result }))
}

fn tool_memory_note(
    vault: &VaultState,
    input: &serde_json::Value,
    auto_agent_id: &str,
) -> Result<serde_json::Value, String> {
    let action = input["action"]
        .as_str()
        .ok_or("memory_note: missing 'action' field")?;

    // Use agent_id from input if provided, otherwise use the auto-injected one
    let agent_id = input["agent_id"]
        .as_str()
        .unwrap_or(auto_agent_id);

    match action {
        "create" => {
            let title = input["title"]
                .as_str()
                .ok_or("memory_note create: missing 'title'")?;
            let content = input["content"]
                .as_str()
                .ok_or("memory_note create: missing 'content'")?;
            let scope = input.get("scope").and_then(|v| v.as_str());
            let category = input.get("category")
                .and_then(|v| v.as_str())
                .unwrap_or("knowledge");
            let tags: Vec<String> = input.get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let related_ids: Vec<String> = input.get("related_ids")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();

            let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
            let note = vm.create_note(
                agent_id,
                scope,
                category,
                title,
                content,
                tags,
                related_ids,
            ).map_err(|e| format!("memory_note create failed: {}", e))?;

            // Return legacy-compatible JSON: { id, agent_id, title, content, created_at, updated_at }
            Ok(serde_json::json!({
                "id": note.id,
                "agent_id": note.agent,
                "title": note.title,
                "content": strip_title_heading(&note.content),
                "created_at": note.created,
                "updated_at": note.updated,
            }))
        }
        "read" => {
            let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;

            if let Some(id) = input.get("id").and_then(|v| v.as_str()) {
                // Single note read
                let note = vm.read_note(id)
                    .map_err(|e| format!("memory_note read failed: {}", e))?;
                Ok(serde_json::json!({
                    "id": note.id,
                    "agent_id": note.agent,
                    "title": note.title,
                    "content": strip_title_heading(&note.content),
                    "created_at": note.created,
                    "updated_at": note.updated,
                }))
            } else {
                // List all notes for agent (legacy behavior)
                let legacy = vm.to_legacy_json(agent_id);
                Ok(serde_json::Value::Array(legacy))
            }
        }
        "update" => {
            let id = input["id"]
                .as_str()
                .ok_or("memory_note update: missing 'id'")?;
            let title = input.get("title").and_then(|v| v.as_str());
            let content = input["content"].as_str();
            let tags: Option<Vec<String>> = input.get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());
            let confidence = input.get("confidence").and_then(|v| v.as_f64());
            let add_links: Option<Vec<String>> = input.get("add_links")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

            let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
            let note = vm.update_note(
                id,
                agent_id,
                title,
                content,
                tags,
                confidence,
                add_links,
            ).map_err(|e| format!("memory_note update failed: {}", e))?;

            Ok(serde_json::json!({
                "id": note.id,
                "agent_id": note.agent,
                "title": note.title,
                "content": strip_title_heading(&note.content),
                "created_at": note.created,
                "updated_at": note.updated,
            }))
        }
        "delete" => {
            let id = input["id"]
                .as_str()
                .ok_or("memory_note delete: missing 'id'")?;
            // Agents cannot delete shared notes — pass agent_id as caller
            let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
            vm.delete_note(id, agent_id)
                .map_err(|e| format!("memory_note delete failed: {}", e))?;
            Ok(serde_json::json!({ "success": true }))
        }
        "search" => {
            let query = input["query"]
                .as_str()
                .ok_or("memory_note search: missing 'query'")?;
            let scope = input.get("scope").and_then(|v| v.as_str());
            let limit = input.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize);

            let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
            let mut results = vm.search(query, Some(agent_id), scope);
            if let Some(max) = limit {
                results.truncate(max);
            }
            Ok(serde_json::to_value(results).unwrap_or(serde_json::json!([])))
        }
        "recall" => {
            let limit = input.get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(10) as usize;

            let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
            let notes = vm.recall(agent_id, limit);
            Ok(serde_json::to_value(notes).unwrap_or(serde_json::json!([])))
        }
        _ => Err(format!("memory_note: unknown action '{}'", action)),
    }
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
    let input: serde_json::Value =
        serde_json::from_str(&tool_input).map_err(|e| AppError::Validation(format!("Invalid tool_input JSON: {}", e)))?;

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
    } else if tool_name == "http_request" {
        HTTP_REQUEST_TIMEOUT
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
            let aid = value.get("artifact_id").and_then(|v| v.as_str()).map(|s| s.to_string());
            (
                "executed".to_string(),
                serde_json::to_string(&value).unwrap_or_default(),
                aid,
            )
        }
        Err(err) => ("error".to_string(), serde_json::json!({ "error": err }).to_string(), None),
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

/// Inner dispatch — routes to the correct tool implementation.
/// Runs inside the timeout wrapper.
async fn execute_tool_inner(
    app: &AppHandle,
    db: &Database,
    tool_name: &str,
    input: &serde_json::Value,
    conversation_id: &str,
) -> Result<serde_json::Value, String> {
    match tool_name {
        "read_file" | "write_file" | "delete_file" | "list_directory" => {
            // File tools are scoped to the agent's workspace directory
            let workspace = resolve_workspace_path(app, db, conversation_id)?;
            let ws_roots = vec![workspace.clone()];

            // Helper: resolve relative paths against the workspace root
            let resolve_path = |raw: &str| -> String {
                if Path::new(raw).is_absolute() {
                    raw.to_string()
                } else {
                    workspace.join(raw).to_string_lossy().to_string()
                }
            };

            match tool_name {
                "read_file" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("read_file: missing 'path' parameter")?;
                    tool_read_file(&resolve_path(raw), &ws_roots)
                }
                "write_file" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("write_file: missing 'path' parameter")?;
                    let content = input["content"]
                        .as_str()
                        .ok_or("write_file: missing 'content' parameter")?;
                    tool_write_file(&resolve_path(raw), content, &ws_roots)
                }
                "delete_file" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("delete_file: missing 'path' parameter")?;
                    tool_delete_file(&resolve_path(raw), &ws_roots)
                }
                "list_directory" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("list_directory: missing 'path' parameter")?;
                    tool_list_directory(&resolve_path(raw), &ws_roots)
                }
                _ => unreachable!(),
            }
        }
        "web_search" => {
            let url = input["url"]
                .as_str()
                .or_else(|| input["query"].as_str())
                .ok_or("web_search: missing 'url' or 'query' parameter")?;
            tool_web_search(url).await
        }
        "memory_note" => {
            // Auto-inject agent_id from conversation so LLM doesn't need to know the DB ID
            let agent_id = operations::get_conversation_detail_impl(db, conversation_id.to_string())
                .map(|c| c.agent_id)
                .unwrap_or_default();
            let vault = app.state::<VaultState>();
            tool_memory_note(&vault, input, &agent_id)
        }

        // ── Browser automation tools ──
        "browser_navigate" | "browser_snapshot" | "browser_click" | "browser_type"
        | "browser_wait" | "browser_back" => {
            let browser = app.state::<crate::browser::BrowserManager>();
            let result = match tool_name {
                "browser_navigate" => {
                    let url = input["url"]
                        .as_str()
                        .ok_or("browser_navigate: missing 'url' parameter")?;
                    browser.navigate(conversation_id, url).await?
                }
                "browser_snapshot" => browser.snapshot(conversation_id).await?,
                "browser_click" => {
                    let ref_num = input["ref"]
                        .as_u64()
                        .ok_or("browser_click: missing 'ref' parameter (u32)")?
                        as u32;
                    browser.click(conversation_id, ref_num).await?
                }
                "browser_type" => {
                    let ref_num = input["ref"]
                        .as_u64()
                        .ok_or("browser_type: missing 'ref' parameter (u32)")?
                        as u32;
                    let text = input["text"]
                        .as_str()
                        .ok_or("browser_type: missing 'text' parameter")?;
                    browser.type_text(conversation_id, ref_num, text).await?
                }
                "browser_wait" => {
                    let seconds = input["seconds"].as_f64().unwrap_or(2.0);
                    browser.wait(conversation_id, seconds).await?
                }
                "browser_back" => browser.back(conversation_id).await?,
                _ => unreachable!(),
            };

            // Get session_id for artifact
            let session_id = {
                let sessions = browser.sessions.lock().await;
                sessions
                    .get(conversation_id)
                    .map(|s| s.session_id.clone())
                    .unwrap_or_default()
            };

            // Save browser artifact to DB
            let ref_map_json = serde_json::to_string(
                &browser.sessions.lock().await
                    .get(conversation_id)
                    .map(|s| &s.last_ref_map)
            )
            .unwrap_or_else(|_| "{}".to_string());

            let artifact = BrowserArtifact {
                id: result.artifact_id.clone(),
                session_id,
                conversation_id: conversation_id.to_string(),
                snapshot_full: result.snapshot_full.clone(),
                ref_map_json,
                url: result.url.clone(),
                title: result.title.clone(),
                screenshot_path: result.screenshot_path.clone(),
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            // Non-fatal: don't fail the tool if artifact save fails
            let _ = operations::create_browser_artifact(db, &artifact);

            Ok(serde_json::to_value(result).unwrap())
        }
        "browser_close" => {
            let browser = app.state::<crate::browser::BrowserManager>();
            browser.close_session(conversation_id).await?;
            Ok(serde_json::json!({ "success": true }))
        }

        "http_request" => {
            tool_http_request(app, input, conversation_id, db).await
        }

        _ => Err(format!("Unknown tool: '{}'", tool_name)),
    }
}

// ── Config normalization ──

/// Normalize a TOOL_CONFIG.json: add missing native tools (disabled), ensure credentials
/// section exists, bump version to 2. Returns (normalized_json, changed).
pub fn normalize_tool_config(config_str: &str) -> Result<(String, bool), String> {
    let mut config: serde_json::Value = serde_json::from_str(config_str)
        .map_err(|e| format!("Invalid TOOL_CONFIG.json: {}", e))?;

    let mut changed = false;

    // Bump version to 2 if needed
    if config["version"].as_u64().unwrap_or(0) < 2 {
        config["version"] = serde_json::json!(2);
        changed = true;
    }

    // Ensure native section exists
    if !config.get("native").and_then(|v| v.as_object()).is_some() {
        config["native"] = serde_json::json!({});
        changed = true;
    }

    // Migration: if write_file is enabled but delete_file is missing, enable delete_file too
    // (must run before "add missing" which would add it as disabled)
    if let Some(native) = config["native"].as_object_mut() {
        let write_file_enabled = native
            .get("write_file")
            .and_then(|v| v.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if write_file_enabled && !native.contains_key("delete_file") {
            native.insert(
                "delete_file".to_string(),
                serde_json::json!({ "enabled": true, "tier": "confirm" }),
            );
            changed = true;
        }
    }

    // Add missing native tools as disabled with their default_tier
    let defs = native_tool_definitions();
    if let Some(native) = config["native"].as_object_mut() {
        for def in &defs {
            if !native.contains_key(&def.name) {
                native.insert(
                    def.name.clone(),
                    serde_json::json!({ "enabled": false, "tier": def.default_tier }),
                );
                changed = true;
            }
        }
    }

    // Ensure auto_approve field exists (default: false)
    if config.get("auto_approve").is_none() {
        config["auto_approve"] = serde_json::json!(false);
        changed = true;
    }

    // Ensure credentials section exists
    if !config.get("credentials").and_then(|v| v.as_object()).is_some() {
        config["credentials"] = serde_json::json!({});
        changed = true;
    }

    let result = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("JSON serialization error: {}", e))?;
    Ok((result, changed))
}

// ── http_request tool ──

const MAX_RESPONSE_BYTES: usize = 512 * 1024; // 512KB

/// Get the set of credential IDs this agent is allowed to use.
fn get_agent_allowed_credentials(
    app: &AppHandle,
    db: &Database,
    conversation_id: &str,
) -> Result<HashSet<String>, String> {
    let conv = operations::get_conversation_detail_impl(db, conversation_id.to_string())
        .map_err(|e| format!("Failed to get conversation: {}", e))?;

    let agent = agent_operations::get_agent_impl(db, conv.agent_id)
        .map_err(|e| format!("Failed to get agent: {}", e))?;

    let agents_dir = get_agents_dir_for_tools(app)?;
    let config_path = agents_dir
        .join(&agent.folder_name)
        .join("TOOL_CONFIG.json");

    let config_str = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(HashSet::new()), // no config → no credentials
    };

    let config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Invalid TOOL_CONFIG.json: {}", e))?;

    let mut allowed = HashSet::new();
    if let Some(creds) = config["credentials"].as_object() {
        for (id, val) in creds {
            // Support both { "allowed": true } (v2 object) and bare true (legacy)
            let is_allowed = val
                .as_object()
                .and_then(|o| o.get("allowed"))
                .and_then(|v| v.as_bool())
                .or_else(|| val.as_bool())
                .unwrap_or(false);
            if is_allowed {
                allowed.insert(id.clone());
            }
        }
    }
    Ok(allowed)
}

/// Validate URL for http_request: scheme, host, private/loopback, credential host matching.
fn validate_http_request_url(
    parsed: &url::Url,
    has_credentials: bool,
    credential_ids: &[String],
    app: &AppHandle,
) -> Result<(), String> {
    let host = parsed.host_str().unwrap_or("");

    // Private/loopback hard deny (no override)
    if credential_service::is_private_or_loopback(host) {
        return Err(format!(
            "http_request: private/loopback address '{}' is not allowed",
            host
        ));
    }

    if has_credentials {
        // Credentialed requests require HTTPS
        if parsed.scheme() != "https" {
            return Err("http_request: credentialed requests require HTTPS".into());
        }

        // Validate host against each credential's allowed_hosts
        for cred_id in credential_ids {
            let meta = credential_service::get_credential_meta(app, cred_id)?;
            if !credential_service::host_matches(host, &meta.allowed_hosts) {
                return Err(format!(
                    "URL host '{}' not in allowed_hosts for credential '{}'",
                    host, cred_id
                ));
            }
        }
    }

    Ok(())
}

/// Substitute `{{credential:ID}}` placeholders in a string with resolved values.
fn substitute_credentials(text: &str, secrets: &[(String, String)]) -> String {
    let mut result = text.to_string();
    for (id, value) in secrets {
        result = result.replace(&format!("{{{{credential:{}}}}}", id), value);
    }
    result
}

/// Read the response body with a size limit, returning (body_text, truncated).
async fn read_response_body(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<(String, u16, String, bool), String> {
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Check content type — only text-based content
    let is_text = content_type.is_empty()
        || content_type.starts_with("text/")
        || content_type.contains("application/json")
        || content_type.contains("application/xml")
        || content_type.contains("application/xhtml")
        || content_type.contains("+json")
        || content_type.contains("+xml");

    if !is_text {
        return Ok((
            format!("[Binary content: {}]", content_type),
            status,
            content_type,
            false,
        ));
    }

    // Stream body with size cap
    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut body = Vec::with_capacity(max_bytes.min(65536));
    let mut truncated = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e: reqwest::Error| format!("Failed to read response: {}", e))?;
        let remaining = max_bytes.saturating_sub(body.len());
        if remaining == 0 {
            truncated = true;
            break;
        }
        let take = chunk.len().min(remaining);
        body.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            truncated = true;
            break;
        }
    }

    let body_str = String::from_utf8_lossy(&body).to_string();
    Ok((body_str, status, content_type, truncated))
}

/// Execute an HTTP request with credential injection and redirect handling.
async fn tool_http_request(
    app: &AppHandle,
    input: &serde_json::Value,
    conversation_id: &str,
    db: &Database,
) -> Result<serde_json::Value, String> {
    // 1. Parse parameters
    let method = input["method"]
        .as_str()
        .unwrap_or("GET")
        .to_uppercase();
    let url_str = input["url"]
        .as_str()
        .ok_or("http_request: missing 'url' parameter")?;
    let headers_input = input["headers"].as_object();
    let body_input = input["body"].as_str();
    let timeout_secs = input["timeout_secs"]
        .as_u64()
        .unwrap_or(30)
        .min(120);

    if !["GET", "POST", "PUT", "DELETE", "PATCH"].contains(&method.as_str()) {
        return Err(format!("http_request: unsupported method '{}'", method));
    }

    // 2. Extract {{credential:ID}} from headers and body ONLY (not URL)
    let mut all_refs: Vec<String> = Vec::new();
    if let Some(hdrs) = headers_input {
        for (_, v) in hdrs {
            if let Some(s) = v.as_str() {
                all_refs.extend(credential_service::extract_credential_refs(s));
            }
        }
    }
    if let Some(body) = body_input {
        all_refs.extend(credential_service::extract_credential_refs(body));
    }
    all_refs.sort();
    all_refs.dedup();
    let has_credentials = !all_refs.is_empty();

    // 3. Resolve credentials: check agent access, get values
    let mut secrets: Vec<(String, String)> = Vec::new();
    if has_credentials {
        let allowed_creds = get_agent_allowed_credentials(app, db, conversation_id)?;
        for id in &all_refs {
            if !allowed_creds.contains(id) {
                return Err(format!(
                    "http_request: agent does not have access to credential '{}'",
                    id
                ));
            }
            let value = credential_service::get_secret(app, id)?;
            secrets.push((id.clone(), value));
        }
    }

    // 4. Validate initial URL
    let parsed_url = url::Url::parse(url_str)
        .map_err(|e| format!("http_request: invalid URL '{}': {}", url_str, e))?;
    validate_http_request_url(&parsed_url, has_credentials, &all_refs, app)?;

    // 5. Substitute credentials in headers and body, track which headers carry secrets
    let mut final_headers: Vec<(String, String)> = Vec::new();
    let mut credential_header_keys: Vec<String> = Vec::new();
    if let Some(hdrs) = headers_input {
        for (k, v) in hdrs {
            if let Some(s) = v.as_str() {
                let substituted = substitute_credentials(s, &secrets);
                if substituted != s {
                    credential_header_keys.push(k.to_lowercase());
                }
                final_headers.push((k.clone(), substituted));
            }
        }
    }
    let final_body = body_input.map(|b| substitute_credentials(b, &secrets));

    // 6. Fail closed: check for unresolved credential references
    for (_, v) in &final_headers {
        if credential_service::has_unresolved_refs(v) {
            return Err("http_request: unresolved credential reference in headers".into());
        }
    }
    if let Some(ref b) = final_body {
        if credential_service::has_unresolved_refs(b) {
            return Err("http_request: unresolved credential reference in body".into());
        }
    }

    // 7. Build HTTP client — always disable auto-redirects to enforce
    // private/loopback deny on every hop (even non-credentialed requests)
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("http_request: client error: {}", e))?;

    // 8. Execute with manual redirect handling for credentialed requests
    let mut current_url = parsed_url;
    let mut current_method = method;
    let mut current_body = final_body;
    let mut current_headers = final_headers;
    let max_redirects: u32 = 3; // manual redirect handling for all requests

    for hop in 0..max_redirects + 1 {
        let mut req = match current_method.as_str() {
            "GET" => client.get(current_url.as_str()),
            "POST" => client.post(current_url.as_str()),
            "PUT" => client.put(current_url.as_str()),
            "DELETE" => client.delete(current_url.as_str()),
            "PATCH" => client.patch(current_url.as_str()),
            _ => unreachable!(),
        };

        req = req.header("User-Agent", "WindowAgent/1.0");
        for (k, v) in &current_headers {
            req = req.header(k, v);
        }
        if let Some(ref body) = current_body {
            req = req.body(body.clone());
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("http_request: request failed: {}", e))?;

        let status = resp.status();

        // Handle redirects — manual for ALL requests to enforce private/loopback deny on every hop
        if status.is_redirection() {
            // Exhausted redirect budget — error out
            if hop >= max_redirects {
                return Err("http_request: too many redirects".into());
            }

            if let Some(location) = resp.headers().get("location") {
                let loc_str = location
                    .to_str()
                    .map_err(|_| "http_request: invalid Location header")?;

                // Resolve relative URLs against current URL
                let next_url = current_url
                    .join(loc_str)
                    .map_err(|e| format!("http_request: invalid redirect URL: {}", e))?;

                // Re-validate scheme + host + private for the redirect target
                validate_http_request_url(&next_url, has_credentials, &all_refs, app)?;

                let status_code = status.as_u16();
                match status_code {
                    307 | 308 => {
                        // Preserve method, body, headers
                    }
                    301 | 302 | 303 => {
                        // Convert to GET, drop body
                        current_method = "GET".to_string();
                        current_body = None;
                        // For credentialed requests: strip ALL credential-bearing headers
                        if has_credentials {
                            current_headers.retain(|(k, _)| {
                                let kl = k.to_lowercase();
                                !kl.eq_ignore_ascii_case("authorization")
                                    && !credential_header_keys.contains(&kl)
                            });
                        }
                    }
                    _ => {
                        // Not a standard redirect — fall through to response processing
                    }
                }

                if matches!(status_code, 301 | 302 | 303 | 307 | 308) {
                    current_url = next_url;
                    continue;
                }
            }
        }

        // 9. Process response
        let (mut body_text, resp_status, content_type, truncated) =
            read_response_body(resp, MAX_RESPONSE_BYTES).await?;

        if truncated {
            body_text = format!(
                "{}... [truncated at {} bytes]",
                body_text, MAX_RESPONSE_BYTES
            );
        }

        // 10. Redact response before returning (before DB persistence)
        if has_credentials {
            body_text = credential_service::redact_output(&body_text, &secrets);
        }

        return Ok(serde_json::json!({
            "status": resp_status,
            "content_type": content_type,
            "body": body_text,
        }));
    }

    Err("http_request: too many redirects".into())
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
    operations::get_browser_artifact(&db, &id).map_err(|e| AppError::Database(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn make_allowed(dir: &Path) -> Vec<PathBuf> {
        vec![dir.to_path_buf()]
    }

    #[test]
    fn test_validate_path_inside_allowed() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.txt");
        fs::write(&file_path, "hello").unwrap();

        let allowed = make_allowed(tmp.path());
        let result = validate_path(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_path_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = validate_path("/etc/passwd", &allowed);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside allowed"));
    }

    #[test]
    fn test_validate_path_traversal_blocked() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let evil = format!("{}/../../../etc/passwd", tmp.path().display());
        let result = validate_path(&evil, &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_path_nonexistent_file_parent_valid() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let new_file = tmp.path().join("newfile.txt");
        let result = validate_path(new_file.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_read_file_success() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("readme.txt");
        fs::write(&file_path, "Hello, world!").unwrap();

        let allowed = make_allowed(tmp.path());
        let result = tool_read_file(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["content"], "Hello, world!");
    }

    #[test]
    fn test_read_file_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_read_file("/etc/hostname", &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_write_file_success() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("output.txt");
        let allowed = make_allowed(tmp.path());

        let result = tool_write_file(file_path.to_str().unwrap(), "written content", &allowed);
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "written content");
    }

    #[test]
    fn test_write_file_creates_subdirectories() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("sub").join("dir").join("file.txt");
        let allowed = make_allowed(tmp.path());

        // Parent doesn't exist yet — validate_path for write resolves parent only if it exists.
        // Create the parent first for this test.
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        let result = tool_write_file(file_path.to_str().unwrap(), "nested", &allowed);
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "nested");
    }

    #[test]
    fn test_write_file_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_write_file("/tmp/evil.txt", "bad", &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_file_success() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("to_delete.txt");
        fs::write(&file_path, "bye").unwrap();

        let allowed = make_allowed(tmp.path());
        let result = tool_delete_file(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
        assert!(!file_path.exists());
    }

    #[test]
    fn test_delete_file_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_delete_file("/etc/hostname", &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_file_nonexistent() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("ghost.txt");
        let allowed = make_allowed(tmp.path());
        let result = tool_delete_file(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_list_directory_success() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("a.txt"), "").unwrap();
        fs::create_dir(tmp.path().join("subdir")).unwrap();

        let allowed = make_allowed(tmp.path());
        let result = tool_list_directory(tmp.path().to_str().unwrap(), &allowed).unwrap();
        let entries = result["entries"].as_array().unwrap();
        assert!(entries.len() >= 2);

        let names: Vec<&str> = entries.iter().filter_map(|e| e["name"].as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"subdir"));
    }

    #[test]
    fn test_list_directory_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_list_directory("/etc", &allowed);
        assert!(result.is_err());
    }

    fn make_test_vault() -> (TempDir, VaultState) {
        let tmp = TempDir::new().unwrap();
        let vm = crate::vault::VaultManager::new(tmp.path().to_path_buf()).unwrap();
        (tmp, std::sync::Mutex::new(vm))
    }

    #[test]
    fn test_memory_note_unknown_action() {
        let (_tmp, vault) = make_test_vault();
        let input = serde_json::json!({ "action": "fly" });
        let result = tool_memory_note(&vault, &input, "test-agent-id");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown action"));
    }

    #[test]
    fn test_memory_note_create_missing_fields() {
        let (_tmp, vault) = make_test_vault();
        let input = serde_json::json!({ "action": "create" });
        let result = tool_memory_note(&vault, &input, "test-agent-id");
        assert!(result.is_err());
    }

    #[test]
    fn test_memory_note_crud_lifecycle() {
        let (_tmp, vault) = make_test_vault();
        let agent_id = "test-agent";

        // Create — agent_id auto-injected via auto_agent_id param
        let create_input = serde_json::json!({
            "action": "create",
            "title": "Test Note",
            "content": "Note body"
        });
        let created = tool_memory_note(&vault, &create_input, agent_id).unwrap();
        assert_eq!(created["title"], "Test Note");
        assert_eq!(created["agent_id"], agent_id);

        let note_id = created["id"].as_str().unwrap();

        // Read — agent_id auto-injected
        let read_input = serde_json::json!({
            "action": "read"
        });
        let notes = tool_memory_note(&vault, &read_input, agent_id).unwrap();
        let arr = notes.as_array().unwrap();
        assert_eq!(arr.len(), 1);

        // Update
        let update_input = serde_json::json!({
            "action": "update",
            "id": note_id,
            "content": "Updated body"
        });
        let updated = tool_memory_note(&vault, &update_input, agent_id).unwrap();
        assert!(updated["content"].as_str().unwrap().contains("Updated body"));

        // Delete
        let delete_input = serde_json::json!({
            "action": "delete",
            "id": note_id
        });
        let deleted = tool_memory_note(&vault, &delete_input, agent_id).unwrap();
        assert_eq!(deleted["success"], true);

        // Verify empty
        let notes_after = tool_memory_note(&vault, &read_input, agent_id).unwrap();
        assert_eq!(notes_after.as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_memory_note_search() {
        let (_tmp, vault) = make_test_vault();
        let agent_id = "test-agent";

        // Create a note
        let create_input = serde_json::json!({
            "action": "create",
            "title": "Rust Programming",
            "content": "Rust is a systems language"
        });
        tool_memory_note(&vault, &create_input, agent_id).unwrap();

        // Search
        let search_input = serde_json::json!({
            "action": "search",
            "query": "Rust"
        });
        let results = tool_memory_note(&vault, &search_input, agent_id).unwrap();
        assert!(!results.as_array().unwrap().is_empty());
    }

    #[test]
    fn test_memory_note_recall() {
        let (_tmp, vault) = make_test_vault();
        let agent_id = "test-agent";

        // Create a few notes
        for i in 0..3 {
            let input = serde_json::json!({
                "action": "create",
                "title": format!("Note {i}"),
                "content": format!("Content {i}")
            });
            tool_memory_note(&vault, &input, agent_id).unwrap();
        }

        // Recall
        let recall_input = serde_json::json!({
            "action": "recall",
            "limit": 2
        });
        let results = tool_memory_note(&vault, &recall_input, agent_id).unwrap();
        assert_eq!(results.as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_normalize_config_adds_delete_file_when_write_enabled() {
        let config = r#"{"version":2,"auto_approve":false,"native":{"read_file":{"enabled":true,"tier":"auto"},"write_file":{"enabled":true,"tier":"confirm"}},"credentials":{}}"#;
        let (normalized, changed) = normalize_tool_config(config).unwrap();
        assert!(changed);
        let parsed: serde_json::Value = serde_json::from_str(&normalized).unwrap();
        let delete = &parsed["native"]["delete_file"];
        assert_eq!(delete["enabled"], true);
        assert_eq!(delete["tier"], "confirm");
    }

    #[test]
    fn test_normalize_config_skips_delete_file_when_write_disabled() {
        let config = r#"{"version":2,"auto_approve":false,"native":{"read_file":{"enabled":true,"tier":"auto"},"write_file":{"enabled":false,"tier":"confirm"}},"credentials":{}}"#;
        let (normalized, changed) = normalize_tool_config(config).unwrap();
        // delete_file is still added via the "add missing native tools" logic, but as disabled
        let parsed: serde_json::Value = serde_json::from_str(&normalized).unwrap();
        let delete = &parsed["native"]["delete_file"];
        assert_eq!(delete["enabled"], false);
        assert!(changed);
    }
}
