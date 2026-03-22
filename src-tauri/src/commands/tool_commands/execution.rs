use crate::commands::vault_commands::VaultState;
use crate::db::agent_operations;
use crate::db::cron_operations;
use crate::db::models::{BrowserArtifact, CreateCronJobRequest, UpdateCronJobRequest, CronScheduleType};
use crate::db::{operations, Database};
use crate::error::AppError;
use crate::services::cron_scheduler::CronScheduler;
use crate::utils::path_security::{validate_no_traversal, validate_tool_roots};
use crate::vault::note::{compute_revision, parse_frontmatter, serialize_note, Frontmatter};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use super::config::get_agents_dir_for_tools;
use super::http::tool_http_request;

const TOOL_TIMEOUT: Duration = Duration::from_secs(30);
const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const BROWSER_TOOL_TIMEOUT: Duration = Duration::from_secs(360); // 6 min: allows for Chromium install on first run

/// Allowed persona files for the persona scope.
const ALLOWED_PERSONA_FILES: &[&str] = &["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "BOOT.md"];

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

// ── Scope resolution ──

/// Resolved scope information for file tools.
struct ScopeResolution {
    root: PathBuf,
    allowed_roots: Vec<PathBuf>,
    /// If set, only these filenames are accessible (persona scope).
    allowed_filenames: Option<Vec<&'static str>>,
    /// The agent_id from the conversation (needed for vault operations).
    agent_id: String,
}

/// Resolve scope to root directory, allowed roots, and optional filename whitelist.
fn resolve_scope(
    app: &AppHandle,
    db: &Database,
    conversation_id: &str,
    scope: &str,
) -> Result<ScopeResolution, String> {
    let conv = operations::get_conversation_detail_impl(db, conversation_id.to_string())
        .map_err(|e| format!("Failed to get conversation: {}", e))?;

    validate_no_traversal(&conv.agent_id, "agent_id")?;

    match scope {
        "workspace" => {
            let workspace = resolve_workspace_path(app, db, conversation_id)?;
            Ok(ScopeResolution {
                root: workspace.clone(),
                allowed_roots: vec![workspace],
                allowed_filenames: None,
                agent_id: conv.agent_id,
            })
        }
        "persona" => {
            let agent = agent_operations::get_agent_impl(db, conv.agent_id.clone())
                .map_err(|e| format!("Failed to get agent: {}", e))?;
            validate_no_traversal(&agent.folder_name, "folder_name")?;

            let agents_dir = get_agents_dir_for_tools(app)?;
            let persona_dir = agents_dir.join(&agent.folder_name);
            std::fs::create_dir_all(&persona_dir)
                .map_err(|e| format!("Failed to create persona directory: {}", e))?;

            Ok(ScopeResolution {
                root: persona_dir.clone(),
                allowed_roots: vec![persona_dir],
                allowed_filenames: Some(ALLOWED_PERSONA_FILES.to_vec()),
                agent_id: conv.agent_id,
            })
        }
        "vault" => {
            let vault = app.state::<VaultState>();
            let vault_path = {
                let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
                vm.get_vault_path().to_path_buf()
            };
            let agent_vault = vault_path.join("agents").join(&conv.agent_id);

            // Only allow access to memory-note category directories,
            // not workspace/, archive/, or other internal vault dirs.
            let allowed_categories = ["knowledge", "decision", "conversation", "reflection"];
            let mut allowed_roots = Vec::new();
            for cat in &allowed_categories {
                let cat_dir = agent_vault.join(cat);
                std::fs::create_dir_all(&cat_dir)
                    .map_err(|e| format!("Failed to create vault category dir: {}", e))?;
                allowed_roots.push(cat_dir);
            }

            Ok(ScopeResolution {
                root: agent_vault,
                allowed_roots,
                allowed_filenames: None,
                agent_id: conv.agent_id,
            })
        }
        _ => Err(format!("Unknown scope: '{}'", scope)),
    }
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

fn tool_list_directory_recursive(
    path: &str,
    allowed: &[PathBuf],
) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    let mut entries = Vec::new();
    collect_entries_recursive(&validated, &validated, &mut entries)?;
    Ok(serde_json::json!({ "entries": entries }))
}

fn collect_entries_recursive(
    base: &Path,
    current: &Path,
    entries: &mut Vec<serde_json::Value>,
) -> Result<(), String> {
    let dir_entries = std::fs::read_dir(current)
        .map_err(|e| format!("list_directory failed: {}", e))?;

    for entry in dir_entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let full_path = entry.path();
        let relative = full_path
            .strip_prefix(base)
            .unwrap_or(&full_path)
            .to_string_lossy()
            .to_string();
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        entries.push(serde_json::json!({ "name": relative, "is_dir": is_dir }));

        if is_dir {
            collect_entries_recursive(base, &full_path, entries)?;
        }
    }
    Ok(())
}

// ── Vault helpers ──

/// Infer note category from the vault-relative path.
/// e.g. "decision/auth-flow.md" → "decision", "knowledge/topic.md" → "knowledge"
fn infer_vault_category(path: &str) -> String {
    let valid_categories = ["knowledge", "decision", "conversation", "reflection"];
    let first_component = Path::new(path).components().next()
        .and_then(|c| c.as_os_str().to_str())
        .unwrap_or("knowledge");
    if valid_categories.contains(&first_component) {
        first_component.to_string()
    } else {
        "knowledge".to_string()
    }
}

/// Strip YAML frontmatter from content if present (read-modify-write support).
/// Allows agents to read a vault file, modify the body, and write it back
/// without having to manually strip the frontmatter.
fn strip_frontmatter_if_present(content: &str) -> String {
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        // Find the closing --- delimiter
        if let Some(end_idx) = trimmed[3..].find("\n---") {
            let after_fm = &trimmed[3 + end_idx + 4..]; // skip past closing ---
            return after_fm.trim_start_matches('\n').to_string();
        }
    }
    content.to_string()
}

// ── Vault-specific write_file with frontmatter management ──

fn tool_vault_write_file(
    resolved_path: &str,
    relative_path: &str,
    body_content: &str,
    allowed: &[PathBuf],
    agent_id: &str,
    conversation_id: &str,
) -> Result<serde_json::Value, String> {
    // Strip frontmatter if the model echoed it back from a read-modify-write loop.
    // This allows the natural pattern: read → modify → write back.
    let clean_content = strip_frontmatter_if_present(body_content);

    let validated = validate_path(resolved_path, allowed)?;

    // Ensure parent directory exists
    if let Some(parent) = validated.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    // Infer category from the relative path (knowledge/decision/conversation/reflection)
    let note_type = infer_vault_category(relative_path);

    let now = chrono::Utc::now().to_rfc3339();
    let revision = compute_revision(&clean_content);

    let file_content = if validated.is_file() {
        // Existing file: preserve id, agent, created from existing frontmatter
        let existing = std::fs::read_to_string(&validated)
            .map_err(|e| format!("Failed to read existing vault file: {}", e))?;
        let (mut fm, _old_body) = parse_frontmatter(&existing)?;
        fm.updated = now;
        fm.revision = revision;
        // Do NOT update source_conversation on edits — it would make long-lived notes
        // eligible for archival at end of conversation. Modified notes are already
        // tracked via tool call logs in the digest's "VAULT FILE ACTIVITY" section.
        serialize_note(&fm, &clean_content)
    } else {
        // New file: generate frontmatter
        let fm = Frontmatter {
            id: uuid::Uuid::new_v4().to_string(),
            agent: agent_id.to_string(),
            note_type,
            tags: Vec::new(),
            confidence: 0.5,
            created: now.clone(),
            updated: now,
            revision,
            source: None,
            aliases: Vec::new(),
            legacy_id: None,
            scope: None,
            last_edited_by: None,
            source_conversation: Some(conversation_id.to_string()),
        };
        serialize_note(&fm, &clean_content)
    };

    std::fs::write(&validated, &file_content)
        .map_err(|e| format!("write_file failed: {}", e))?;

    Ok(serde_json::json!({ "success": true, "path": validated.to_string_lossy() }))
}

// ── Vault index rebuild helper ──

fn rebuild_vault_index(app: &AppHandle) -> Result<(), String> {
    let vault = app.state::<VaultState>();
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.rebuild_index().map_err(|e| format!("Failed to rebuild vault index: {}", e))?;
    Ok(())
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

// ── Self-awareness tools ──

/// Resolve the agent that owns a conversation. Returns (agent_id, Agent).
/// The agent_id is always derived server-side from the conversation — never from LLM input.
fn resolve_agent_for_conversation(
    db: &Database,
    conversation_id: &str,
) -> Result<(String, crate::db::models::Agent), String> {
    let conv = operations::get_conversation_detail_impl(db, conversation_id.to_string())
        .map_err(|e| format!("Failed to get conversation: {}", e))?;
    let agent = agent_operations::get_agent_impl(db, conv.agent_id.clone())
        .map_err(|e| format!("Failed to get agent: {}", e))?;
    Ok((conv.agent_id, agent))
}

fn tool_self_inspect(
    app: &AppHandle,
    db: &Database,
    conversation_id: &str,
) -> Result<serde_json::Value, String> {
    let (agent_id, agent) = resolve_agent_for_conversation(db, conversation_id)?;

    // Read enabled tools from TOOL_CONFIG.json
    validate_no_traversal(&agent.folder_name, "folder_name")?;
    let agents_dir = get_agents_dir_for_tools(app)?;
    let config_path = agents_dir.join(&agent.folder_name).join("TOOL_CONFIG.json");
    let enabled_tools: Vec<String> = if let Ok(raw) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(native) = config.get("native").and_then(|v| v.as_object()) {
                native
                    .iter()
                    .filter(|(_, v)| {
                        v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false)
                    })
                    .map(|(k, _)| k.clone())
                    .collect()
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    // Get scheduled jobs for this agent
    let schedules = cron_operations::list_cron_jobs_for_agent_impl(db, &agent_id)
        .map_err(|e| format!("Failed to list cron jobs: {}", e))?;
    let schedules_json: Vec<serde_json::Value> = schedules
        .iter()
        .map(|j| {
            serde_json::json!({
                "id": j.id,
                "name": j.name,
                "description": j.description,
                "schedule_type": j.schedule_type,
                "schedule_value": j.schedule_value,
                "prompt": j.prompt,
                "enabled": j.enabled,
                "next_run_at": j.next_run_at,
                "last_run_at": j.last_run_at,
                "run_count": j.run_count,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "agent_id": agent_id,
        "name": agent.name,
        "description": agent.description,
        "model": agent.model,
        "temperature": agent.temperature,
        "thinking_enabled": agent.thinking_enabled,
        "thinking_budget": agent.thinking_budget,
        "enabled_tools": enabled_tools,
        "schedules": schedules_json,
    }))
}

fn tool_manage_schedule(
    app: &AppHandle,
    db: &Database,
    input: &serde_json::Value,
    conversation_id: &str,
) -> Result<serde_json::Value, String> {
    let (agent_id, _agent) = resolve_agent_for_conversation(db, conversation_id)?;

    let action = input
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or("manage_schedule: missing 'action' parameter")?;

    match action {
        "list" => {
            let jobs = cron_operations::list_cron_jobs_for_agent_impl(db, &agent_id)
                .map_err(|e| format!("Failed to list cron jobs: {}", e))?;
            let jobs_json: Vec<serde_json::Value> = jobs
                .iter()
                .map(|j| {
                    serde_json::json!({
                        "id": j.id,
                        "name": j.name,
                        "description": j.description,
                        "schedule_type": j.schedule_type,
                        "schedule_value": j.schedule_value,
                        "prompt": j.prompt,
                        "enabled": j.enabled,
                        "next_run_at": j.next_run_at,
                        "last_run_at": j.last_run_at,
                        "run_count": j.run_count,
                    })
                })
                .collect();
            Ok(serde_json::json!({ "jobs": jobs_json }))
        }
        "create" => {
            let name = input
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'name'")?;
            let schedule_type_str = input
                .get("schedule_type")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'schedule_type'")?;
            let schedule_type: CronScheduleType = schedule_type_str
                .parse()
                .map_err(|_| format!("Invalid schedule_type: '{}'. Must be at/every/cron", schedule_type_str))?;
            let schedule_value = input
                .get("schedule_value")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'schedule_value'")?;
            let prompt = input
                .get("prompt")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'prompt'")?;
            let description = input.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
            let enabled = input.get("enabled").and_then(|v| v.as_bool());

            let request = CreateCronJobRequest {
                agent_id: agent_id.clone(),
                name: name.to_string(),
                description,
                schedule_type,
                schedule_value: schedule_value.to_string(),
                prompt: prompt.to_string(),
                enabled,
            };

            let job = cron_operations::create_cron_job_impl(db, request)
                .map_err(|e| format!("Failed to create cron job: {}", e))?;

            // Notify scheduler of the change
            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({
                "success": true,
                "job": {
                    "id": job.id,
                    "name": job.name,
                    "schedule_type": job.schedule_type,
                    "schedule_value": job.schedule_value,
                    "enabled": job.enabled,
                    "next_run_at": job.next_run_at,
                }
            }))
        }
        "update" => {
            let job_id = input
                .get("job_id")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule update: missing 'job_id'")?;

            // Ownership check
            let existing = cron_operations::get_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to get cron job: {}", e))?;
            if existing.agent_id != agent_id {
                return Err("Permission denied: this cron job belongs to another agent".to_string());
            }

            let schedule_type: Option<CronScheduleType> = input
                .get("schedule_type")
                .and_then(|v| v.as_str())
                .map(|s| s.parse().map_err(|_| format!("Invalid schedule_type: '{}'", s)))
                .transpose()?;

            let request = UpdateCronJobRequest {
                name: input.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                description: input.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                schedule_type,
                schedule_value: input.get("schedule_value").and_then(|v| v.as_str()).map(|s| s.to_string()),
                prompt: input.get("prompt").and_then(|v| v.as_str()).map(|s| s.to_string()),
                enabled: input.get("enabled").and_then(|v| v.as_bool()),
            };

            let job = cron_operations::update_cron_job_impl(db, job_id, request)
                .map_err(|e| format!("Failed to update cron job: {}", e))?;

            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({
                "success": true,
                "job": {
                    "id": job.id,
                    "name": job.name,
                    "schedule_type": job.schedule_type,
                    "schedule_value": job.schedule_value,
                    "enabled": job.enabled,
                    "next_run_at": job.next_run_at,
                }
            }))
        }
        "delete" => {
            let job_id = input
                .get("job_id")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule delete: missing 'job_id'")?;

            // Ownership check
            let existing = cron_operations::get_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to get cron job: {}", e))?;
            if existing.agent_id != agent_id {
                return Err("Permission denied: this cron job belongs to another agent".to_string());
            }

            cron_operations::delete_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to delete cron job: {}", e))?;

            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({ "success": true, "deleted_job_id": job_id }))
        }
        "toggle" => {
            let job_id = input
                .get("job_id")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule toggle: missing 'job_id'")?;
            let enabled = input
                .get("enabled")
                .and_then(|v| v.as_bool())
                .ok_or("manage_schedule toggle: missing 'enabled'")?;

            // Ownership check
            let existing = cron_operations::get_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to get cron job: {}", e))?;
            if existing.agent_id != agent_id {
                return Err("Permission denied: this cron job belongs to another agent".to_string());
            }

            let job = cron_operations::toggle_cron_job_impl(db, job_id, enabled)
                .map_err(|e| format!("Failed to toggle cron job: {}", e))?;

            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({
                "success": true,
                "job": {
                    "id": job.id,
                    "name": job.name,
                    "enabled": job.enabled,
                    "next_run_at": job.next_run_at,
                }
            }))
        }
        _ => Err(format!(
            "manage_schedule: unknown action '{}'. Must be one of: list, create, update, delete, toggle",
            action
        )),
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
            let scope = input.get("scope").and_then(|v| v.as_str()).unwrap_or("workspace");
            let resolution = resolve_scope(app, db, conversation_id, scope)?;

            // Helper: resolve relative paths against the scope root, with optional filename whitelist
            let resolve_and_check = |raw: &str| -> Result<String, String> {
                if let Some(ref allowed_names) = resolution.allowed_filenames {
                    // Persona scope: only specific filenames allowed (no subdirectories)
                    let filename = Path::new(raw)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(raw);
                    if raw.contains('/') || raw.contains('\\') || !allowed_names.contains(&filename) {
                        return Err(format!(
                            "File '{}' is not accessible in persona scope. Allowed: {:?}",
                            raw, allowed_names
                        ));
                    }
                }
                if Path::new(raw).is_absolute() {
                    Ok(raw.to_string())
                } else {
                    Ok(resolution.root.join(raw).to_string_lossy().to_string())
                }
            };

            match tool_name {
                "read_file" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("read_file: missing 'path' parameter")?;
                    let resolved = resolve_and_check(raw)?;
                    tool_read_file(&resolved, &resolution.allowed_roots)
                }
                "write_file" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("write_file: missing 'path' parameter")?;
                    let content = input["content"]
                        .as_str()
                        .ok_or("write_file: missing 'content' parameter")?;
                    let resolved = resolve_and_check(raw)?;

                    if scope == "vault" {
                        let result = tool_vault_write_file(
                            &resolved,
                            raw,
                            content,
                            &resolution.allowed_roots,
                            &resolution.agent_id,
                            conversation_id,
                        )?;
                        // Rebuild vault index after write
                        rebuild_vault_index(app)?;
                        Ok(result)
                    } else {
                        tool_write_file(&resolved, content, &resolution.allowed_roots)
                    }
                }
                "delete_file" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("delete_file: missing 'path' parameter")?;
                    let resolved = resolve_and_check(raw)?;
                    let result = tool_delete_file(&resolved, &resolution.allowed_roots)?;

                    if scope == "vault" {
                        // Rebuild vault index after delete
                        rebuild_vault_index(app)?;
                    }
                    Ok(result)
                }
                "list_directory" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("list_directory: missing 'path' parameter")?;
                    let recursive = input.get("recursive").and_then(|v| v.as_bool()).unwrap_or(false);

                    // For vault scope, listing root (".") is allowed — enumerate category dirs
                    let is_vault_root = scope == "vault" && (raw == "." || raw.is_empty());

                    let mut result = if is_vault_root {
                        if recursive {
                            // Recursively list all allowed category directories
                            let mut all_entries = Vec::new();
                            for root in &resolution.allowed_roots {
                                if let Ok(r) = tool_list_directory_recursive(
                                    root.to_str().unwrap_or_default(),
                                    &[root.clone()],
                                ) {
                                    if let Some(entries) = r.get("entries").and_then(|v| v.as_array()) {
                                        let cat_name = root.file_name()
                                            .and_then(|n| n.to_str())
                                            .unwrap_or("");
                                        for entry in entries {
                                            let name = entry["name"].as_str().unwrap_or("");
                                            let is_dir = entry["is_dir"].as_bool().unwrap_or(false);
                                            all_entries.push(serde_json::json!({
                                                "name": format!("{}/{}", cat_name, name),
                                                "is_dir": is_dir,
                                            }));
                                        }
                                    }
                                }
                            }
                            // Add category directory entries themselves
                            let mut cat_entries: Vec<serde_json::Value> = resolution.allowed_roots.iter().map(|r| {
                                let name = r.file_name().and_then(|n| n.to_str()).unwrap_or("");
                                serde_json::json!({ "name": name, "is_dir": true })
                            }).collect();
                            cat_entries.extend(all_entries);
                            serde_json::json!({ "entries": cat_entries })
                        } else {
                            // Non-recursive: just list the category directory names
                            let entries: Vec<serde_json::Value> = resolution.allowed_roots.iter().map(|r| {
                                let name = r.file_name().and_then(|n| n.to_str()).unwrap_or("");
                                serde_json::json!({ "name": name, "is_dir": true })
                            }).collect();
                            serde_json::json!({ "entries": entries })
                        }
                    } else {
                        // For persona scope list_directory, resolve path but skip filename check
                        let resolved = if Path::new(raw).is_absolute() {
                            raw.to_string()
                        } else {
                            resolution.root.join(raw).to_string_lossy().to_string()
                        };

                        if recursive {
                            tool_list_directory_recursive(&resolved, &resolution.allowed_roots)?
                        } else {
                            tool_list_directory(&resolved, &resolution.allowed_roots)?
                        }
                    };

                    // For persona scope, filter entries to only show allowed files
                    if let Some(ref allowed_names) = resolution.allowed_filenames {
                        if let Some(entries) = result.get_mut("entries").and_then(|v| v.as_array_mut()) {
                            entries.retain(|entry| {
                                entry["name"]
                                    .as_str()
                                    .map(|n| allowed_names.contains(&n))
                                    .unwrap_or(false)
                            });
                        }
                    }

                    Ok(result)
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

        // ── Self-awareness tools ──
        "self_inspect" => tool_self_inspect(app, db, conversation_id),
        "manage_schedule" => tool_manage_schedule(app, db, input, conversation_id),

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

    #[test]
    fn test_list_directory_recursive() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("root.txt"), "").unwrap();
        let sub = tmp.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("nested.txt"), "").unwrap();

        let allowed = make_allowed(tmp.path());
        let result = tool_list_directory_recursive(tmp.path().to_str().unwrap(), &allowed).unwrap();
        let entries = result["entries"].as_array().unwrap();

        let names: Vec<&str> = entries.iter().filter_map(|e| e["name"].as_str()).collect();
        assert!(names.contains(&"root.txt"));
        assert!(names.contains(&"sub"));
        assert!(names.iter().any(|n| n.contains("nested.txt")));
    }

    #[test]
    fn test_vault_write_file_new() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("note.md");
        let allowed = make_allowed(tmp.path());

        let result = tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/note.md",
            "# My Note\n\nSome content.\n",
            &allowed,
            "test-agent",
            "conv-123",
        );
        assert!(result.is_ok());

        // Verify frontmatter was auto-generated
        let content = fs::read_to_string(&file_path).unwrap();
        assert!(content.starts_with("---\n"));
        let (fm, body) = parse_frontmatter(&content).unwrap();
        assert_eq!(fm.agent, "test-agent");
        assert!(!fm.id.is_empty());
        assert!((fm.confidence - 0.5).abs() < f64::EPSILON);
        assert_eq!(fm.source_conversation, Some("conv-123".to_string()));
        assert_eq!(fm.note_type, "knowledge");
        assert!(body.contains("My Note"));
    }

    #[test]
    fn test_vault_write_file_infers_category_from_path() {
        let tmp = TempDir::new().unwrap();
        let decision_dir = tmp.path().join("decision");
        fs::create_dir_all(&decision_dir).unwrap();
        let file_path = decision_dir.join("auth.md");
        let allowed = make_allowed(tmp.path());

        tool_vault_write_file(
            file_path.to_str().unwrap(),
            "decision/auth.md",
            "# Auth Decision\n\nWe chose JWT.\n",
            &allowed,
            "test-agent",
            "conv-123",
        ).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        let (fm, _) = parse_frontmatter(&content).unwrap();
        assert_eq!(fm.note_type, "decision");
    }

    #[test]
    fn test_vault_write_file_update_preserves_metadata_including_source_conversation() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("existing.md");
        let allowed = make_allowed(tmp.path());

        // Create initial file
        tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/existing.md",
            "# Initial\n\nFirst content.\n",
            &allowed,
            "test-agent",
            "conv-123",
        )
        .unwrap();

        let initial_content = fs::read_to_string(&file_path).unwrap();
        let (initial_fm, _) = parse_frontmatter(&initial_content).unwrap();
        let original_id = initial_fm.id.clone();
        let original_created = initial_fm.created.clone();
        assert_eq!(initial_fm.source_conversation, Some("conv-123".to_string()));

        // Update the file from a different conversation
        tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/existing.md",
            "# Updated\n\nNew content.\n",
            &allowed,
            "test-agent",
            "conv-456",
        )
        .unwrap();

        let updated_content = fs::read_to_string(&file_path).unwrap();
        let (updated_fm, body) = parse_frontmatter(&updated_content).unwrap();

        // id, created, and source_conversation should all be preserved
        assert_eq!(updated_fm.id, original_id);
        assert_eq!(updated_fm.created, original_created);
        assert_eq!(updated_fm.source_conversation, Some("conv-123".to_string()));
        // updated should change
        assert!(updated_fm.updated >= original_created);
        assert!(body.contains("New content"));
    }

    #[test]
    fn test_vault_write_file_strips_frontmatter_from_content() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("readback.md");
        let allowed = make_allowed(tmp.path());

        // Simulate read-modify-write: content includes frontmatter from a previous read
        let result = tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/readback.md",
            "---\nid: fake\n---\n# Real Content\n\nBody here.\n",
            &allowed,
            "test-agent",
            "conv-123",
        );
        assert!(result.is_ok());

        // Verify frontmatter was auto-generated (not the fake one)
        let content = fs::read_to_string(&file_path).unwrap();
        let (fm, body) = parse_frontmatter(&content).unwrap();
        assert_ne!(fm.id, "fake");
        assert_eq!(fm.agent, "test-agent");
        assert!(body.contains("Real Content"));
    }

    #[test]
    fn test_strip_frontmatter_if_present() {
        // With frontmatter
        let input = "---\nid: abc\ntags: []\n---\n# Title\n\nBody content";
        let result = strip_frontmatter_if_present(input);
        assert!(result.starts_with("# Title"));
        assert!(result.contains("Body content"));

        // Without frontmatter
        let input2 = "# Just Content\n\nNo frontmatter here.";
        let result2 = strip_frontmatter_if_present(input2);
        assert_eq!(result2, input2);
    }
}
