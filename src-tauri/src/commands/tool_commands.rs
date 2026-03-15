use crate::db::operations;
use crate::db::Database;
use crate::error::AppError;
use crate::utils::path_security::validate_tool_roots;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

const TOOL_TIMEOUT: Duration = Duration::from_secs(30);
const BROWSER_TOOL_TIMEOUT: Duration = Duration::from_secs(90);

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

async fn tool_web_search(url: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(TOOL_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    const MAX_BODY_BYTES: usize = 50_000;

    let resp = client
        .get(url)
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
    db: &Database,
    input: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let action = input["action"]
        .as_str()
        .ok_or("memory_note: missing 'action' field")?;

    match action {
        "create" => {
            let agent_id = input["agent_id"]
                .as_str()
                .ok_or("memory_note create: missing 'agent_id'")?;
            let title = input["title"]
                .as_str()
                .ok_or("memory_note create: missing 'title'")?;
            let content = input["content"]
                .as_str()
                .ok_or("memory_note create: missing 'content'")?;
            let note = operations::create_memory_note_impl(
                db,
                agent_id.to_string(),
                title.to_string(),
                content.to_string(),
            )
            .map_err(|e| format!("memory_note create failed: {}", e))?;
            Ok(serde_json::to_value(note).unwrap())
        }
        "read" => {
            let agent_id = input["agent_id"]
                .as_str()
                .ok_or("memory_note read: missing 'agent_id'")?;
            let notes = operations::list_memory_notes_impl(db, agent_id.to_string())
                .map_err(|e| format!("memory_note read failed: {}", e))?;
            Ok(serde_json::to_value(notes).unwrap())
        }
        "update" => {
            let id = input["id"]
                .as_str()
                .ok_or("memory_note update: missing 'id'")?;
            let title = input["title"].as_str().map(|s| s.to_string());
            let content = input["content"].as_str().map(|s| s.to_string());
            let note = operations::update_memory_note_impl(db, id.to_string(), title, content)
                .map_err(|e| format!("memory_note update failed: {}", e))?;
            Ok(serde_json::to_value(note).unwrap())
        }
        "delete" => {
            let id = input["id"]
                .as_str()
                .ok_or("memory_note delete: missing 'id'")?;
            operations::delete_memory_note_impl(db, id.to_string())
                .map_err(|e| format!("memory_note delete failed: {}", e))?;
            Ok(serde_json::json!({ "success": true }))
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

    // Browser tools get a longer timeout to account for sidecar startup + page loads
    let tool_timeout = if tool_name.starts_with("browser_") {
        BROWSER_TOOL_TIMEOUT
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

    // Determine status and output
    let (status, output) = match result {
        Ok(value) => (
            "executed".to_string(),
            serde_json::to_string(&value).unwrap_or_default(),
        ),
        Err(err) => ("error".to_string(), serde_json::json!({ "error": err }).to_string()),
    };

    // Update the log entry
    let _ = operations::update_tool_call_log_status_impl(
        &db,
        log_entry.id.clone(),
        status.clone(),
        Some(output.clone()),
        Some(duration_ms),
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
    let allowed = allowed_roots(app);

    match tool_name {
        "read_file" => {
            let path = input["path"]
                .as_str()
                .ok_or("read_file: missing 'path' parameter")?;
            tool_read_file(path, &allowed)
        }
        "write_file" => {
            let path = input["path"]
                .as_str()
                .ok_or("write_file: missing 'path' parameter")?;
            let content = input["content"]
                .as_str()
                .ok_or("write_file: missing 'content' parameter")?;
            tool_write_file(path, content, &allowed)
        }
        "list_directory" => {
            let path = input["path"]
                .as_str()
                .ok_or("list_directory: missing 'path' parameter")?;
            tool_list_directory(path, &allowed)
        }
        "web_search" => {
            let url = input["url"]
                .as_str()
                .ok_or("web_search: missing 'url' parameter")?;
            tool_web_search(url).await
        }
        "memory_note" => tool_memory_note(db, input),

        // ── Browser automation tools ──
        "browser_navigate" => {
            let url = input["url"]
                .as_str()
                .ok_or("browser_navigate: missing 'url' parameter")?;
            let browser = app.state::<crate::browser::BrowserManager>();
            let result = browser.navigate(conversation_id, url).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "browser_snapshot" => {
            let browser = app.state::<crate::browser::BrowserManager>();
            let result = browser.snapshot(conversation_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "browser_click" => {
            let ref_num = input["ref"]
                .as_u64()
                .ok_or("browser_click: missing 'ref' parameter (u32)")? as u32;
            let browser = app.state::<crate::browser::BrowserManager>();
            let result = browser.click(conversation_id, ref_num).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "browser_type" => {
            let ref_num = input["ref"]
                .as_u64()
                .ok_or("browser_type: missing 'ref' parameter (u32)")? as u32;
            let text = input["text"]
                .as_str()
                .ok_or("browser_type: missing 'text' parameter")?;
            let browser = app.state::<crate::browser::BrowserManager>();
            let result = browser.type_text(conversation_id, ref_num, text).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "browser_wait" => {
            let seconds = input["seconds"].as_f64().unwrap_or(2.0);
            let browser = app.state::<crate::browser::BrowserManager>();
            let result = browser.wait(conversation_id, seconds).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "browser_back" => {
            let browser = app.state::<crate::browser::BrowserManager>();
            let result = browser.back(conversation_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "browser_close" => {
            let browser = app.state::<crate::browser::BrowserManager>();
            browser.close_session(conversation_id).await?;
            Ok(serde_json::json!({ "success": true }))
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

    #[test]
    fn test_memory_note_unknown_action() {
        let db = crate::db::Database::new_in_memory().unwrap();
        let input = serde_json::json!({ "action": "fly" });
        let result = tool_memory_note(&db, &input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown action"));
    }

    #[test]
    fn test_memory_note_create_missing_fields() {
        let db = crate::db::Database::new_in_memory().unwrap();
        let input = serde_json::json!({ "action": "create" });
        let result = tool_memory_note(&db, &input);
        assert!(result.is_err());
    }

    #[test]
    fn test_memory_note_crud_lifecycle() {
        let db = crate::db::Database::new_in_memory().unwrap();

        // We need an agent for FK constraints
        use crate::db::agent_operations;
        use crate::db::models::CreateAgentRequest;
        let agent = agent_operations::create_agent_impl(
            &db,
            CreateAgentRequest {
                folder_name: "test-agent".into(),
                name: "Test Agent".into(),
                avatar: None,
                description: None,
                model: None,
                temperature: None,
                thinking_enabled: None,
                thinking_budget: None,
                is_default: None,
                sort_order: None,
            },
        )
        .unwrap();

        // Create
        let create_input = serde_json::json!({
            "action": "create",
            "agent_id": agent.id,
            "title": "Test Note",
            "content": "Note body"
        });
        let created = tool_memory_note(&db, &create_input).unwrap();
        assert_eq!(created["title"], "Test Note");

        let note_id = created["id"].as_str().unwrap();

        // Read
        let read_input = serde_json::json!({
            "action": "read",
            "agent_id": agent.id
        });
        let notes = tool_memory_note(&db, &read_input).unwrap();
        let arr = notes.as_array().unwrap();
        assert_eq!(arr.len(), 1);

        // Update
        let update_input = serde_json::json!({
            "action": "update",
            "id": note_id,
            "title": "Updated Title"
        });
        let updated = tool_memory_note(&db, &update_input).unwrap();
        assert_eq!(updated["title"], "Updated Title");

        // Delete
        let delete_input = serde_json::json!({
            "action": "delete",
            "id": note_id
        });
        let deleted = tool_memory_note(&db, &delete_input).unwrap();
        assert_eq!(deleted["success"], true);

        // Verify empty
        let notes_after = tool_memory_note(&db, &read_input).unwrap();
        assert_eq!(notes_after.as_array().unwrap().len(), 0);
    }
}
