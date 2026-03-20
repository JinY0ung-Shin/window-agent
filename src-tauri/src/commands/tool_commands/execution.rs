use crate::commands::vault_commands::VaultState;
use crate::db::models::BrowserArtifact;
use crate::db::{operations, Database};
use crate::error::AppError;
use crate::utils::path_security::{validate_no_traversal, validate_tool_roots};
use crate::vault::strip_title_heading;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use super::http::tool_http_request;

const TOOL_TIMEOUT: Duration = Duration::from_secs(30);
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
) -> Result<String, AppError> {
    let ws = resolve_workspace_path(&app, &db, &conversation_id).map_err(AppError::Io)?;
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
    conversation_id: &str,
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
            let note = vm.create_note_with_provenance(
                agent_id,
                scope,
                category,
                title,
                content,
                tags,
                related_ids,
                if conversation_id.is_empty() { None } else { Some(conversation_id) },
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
                // List all notes for agent
                let summaries = vm.list_notes(Some(agent_id), None, None);
                let items: Vec<serde_json::Value> = summaries
                    .into_iter()
                    .filter(|n| n.scope.as_deref() != Some("shared"))
                    .filter_map(|n| {
                        let full = vm.read_note(&n.id).ok()?;
                        Some(serde_json::json!({
                            "id": full.id,
                            "agent_id": full.agent,
                            "title": full.title,
                            "content": strip_title_heading(&full.content),
                            "created_at": full.created,
                            "updated_at": full.updated,
                        }))
                    })
                    .collect();
                Ok(serde_json::Value::Array(items))
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
            tool_memory_note(&vault, input, &agent_id, conversation_id)
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

            // Get session_id for artifact (read-only)
            let session_id = {
                let sessions = browser.sessions.read().await;
                sessions
                    .get(conversation_id)
                    .map(|s| s.session_id.clone())
                    .unwrap_or_default()
            };

            // Save browser artifact to DB (read-only)
            let ref_map_json = serde_json::to_string(
                &browser.sessions.read().await
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

            serde_json::to_value(result)
                .map_err(|e| format!("failed to serialize browser result: {e}"))
        }
        "browser_close" => {
            let browser = app.state::<crate::browser::BrowserManager>();
            browser.close_session(conversation_id).await?;
            Ok(serde_json::json!({ "success": true }))
        }

        "http_request" => {
            tool_http_request(app, input, conversation_id, db).await
        }

        // ── Orchestration tools ──
        // These are not executed directly — the frontend/orchestrator intercepts them.
        // If they reach here, return a structured result indicating orchestration action.
        "delegate" | "report" => {
            Ok(serde_json::json!({
                "orchestration": true,
                "tool": tool_name,
                "input": input,
            }))
        }

        _ => Err(format!("Unknown tool: '{}'", tool_name)),
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
        let result = tool_memory_note(&vault, &input, "test-agent-id", "");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown action"));
    }

    #[test]
    fn test_memory_note_create_missing_fields() {
        let (_tmp, vault) = make_test_vault();
        let input = serde_json::json!({ "action": "create" });
        let result = tool_memory_note(&vault, &input, "test-agent-id", "");
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
        let created = tool_memory_note(&vault, &create_input, agent_id, "").unwrap();
        assert_eq!(created["title"], "Test Note");
        assert_eq!(created["agent_id"], agent_id);

        let note_id = created["id"].as_str().unwrap();

        // Read — agent_id auto-injected
        let read_input = serde_json::json!({
            "action": "read"
        });
        let notes = tool_memory_note(&vault, &read_input, agent_id, "").unwrap();
        let arr = notes.as_array().unwrap();
        assert_eq!(arr.len(), 1);

        // Update
        let update_input = serde_json::json!({
            "action": "update",
            "id": note_id,
            "content": "Updated body"
        });
        let updated = tool_memory_note(&vault, &update_input, agent_id, "").unwrap();
        assert!(updated["content"].as_str().unwrap().contains("Updated body"));

        // Delete
        let delete_input = serde_json::json!({
            "action": "delete",
            "id": note_id
        });
        let deleted = tool_memory_note(&vault, &delete_input, agent_id, "").unwrap();
        assert_eq!(deleted["success"], true);

        // Verify empty
        let notes_after = tool_memory_note(&vault, &read_input, agent_id, "").unwrap();
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
        tool_memory_note(&vault, &create_input, agent_id, "").unwrap();

        // Search
        let search_input = serde_json::json!({
            "action": "search",
            "query": "Rust"
        });
        let results = tool_memory_note(&vault, &search_input, agent_id, "").unwrap();
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
            tool_memory_note(&vault, &input, agent_id, "").unwrap();
        }

        // Recall
        let recall_input = serde_json::json!({
            "action": "recall",
            "limit": 2
        });
        let results = tool_memory_note(&vault, &recall_input, agent_id, "").unwrap();
        assert_eq!(results.as_array().unwrap().len(), 2);
    }
}
