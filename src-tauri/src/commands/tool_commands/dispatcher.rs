use crate::commands::vault_commands::VaultState;
use crate::db::agent_operations;
use crate::db::models::BrowserArtifact;
use crate::db::{operations, Database};
use crate::utils::config_helpers::agents_dir;
use crate::utils::path_security::{validate_no_traversal, validate_tool_roots};
use std::path::Path;
use tauri::{AppHandle, Manager};

use super::file_tools::{
    index_single_vault_note, remove_vault_note_by_path, tool_delete_file,
    tool_list_directory, tool_list_directory_recursive, tool_read_file, tool_vault_write_file,
    tool_web_search, tool_write_file,
};
use super::http::tool_http_request;
use super::scope::{resolve_scope, ScopeResolution};
use super::self_tools::{tool_manage_schedule, tool_self_inspect};
use super::shell_tools::tool_run_command;

/// Inner dispatch — routes to the correct tool implementation.
/// Runs inside the timeout wrapper.
pub(crate) async fn execute_tool_inner(
    app: &AppHandle,
    db: &Database,
    tool_name: &str,
    input: &serde_json::Value,
    conversation_id: &str,
) -> Result<serde_json::Value, String> {
    match tool_name {
        "read_file" | "write_file" | "delete_file" | "list_directory" => {
            let scope = input
                .get("scope")
                .and_then(|v| v.as_str())
                .unwrap_or("workspace");
            let resolution = resolve_scope(app, db, conversation_id, scope)?;

            // Helper: resolve relative paths against the scope root, with optional filename whitelist
            let resolve_and_check = |raw: &str| -> Result<String, String> {
                if let Some(ref allowed_names) = resolution.allowed_filenames {
                    // Persona scope: only specific filenames allowed (no subdirectories)
                    let filename = Path::new(raw)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(raw);
                    if raw.contains('/') || raw.contains('\\') || !allowed_names.contains(&filename)
                    {
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
                        // Incrementally index the written note
                        index_single_vault_note(app, &resolved)?;
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
                    if scope == "vault" {
                        // Remove from vault index before deleting
                        remove_vault_note_by_path(app, &resolved)?;
                    }
                    let result = tool_delete_file(&resolved, &resolution.allowed_roots)?;
                    Ok(result)
                }
                "list_directory" => {
                    let raw = input["path"]
                        .as_str()
                        .ok_or("list_directory: missing 'path' parameter")?;
                    let recursive = input
                        .get("recursive")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

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
                                    if let Some(entries) =
                                        r.get("entries").and_then(|v| v.as_array())
                                    {
                                        let cat_name = root
                                            .file_name()
                                            .and_then(|n| n.to_str())
                                            .unwrap_or("");
                                        for entry in entries {
                                            let name =
                                                entry["name"].as_str().unwrap_or("");
                                            let is_dir =
                                                entry["is_dir"].as_bool().unwrap_or(false);
                                            all_entries.push(serde_json::json!({
                                                "name": format!("{}/{}", cat_name, name),
                                                "is_dir": is_dir,
                                            }));
                                        }
                                    }
                                }
                            }
                            // Add category directory entries themselves
                            let mut cat_entries: Vec<serde_json::Value> = resolution
                                .allowed_roots
                                .iter()
                                .map(|r| {
                                    let name =
                                        r.file_name().and_then(|n| n.to_str()).unwrap_or("");
                                    serde_json::json!({ "name": name, "is_dir": true })
                                })
                                .collect();
                            cat_entries.extend(all_entries);
                            serde_json::json!({ "entries": cat_entries })
                        } else {
                            // Non-recursive: just list the category directory names
                            let entries: Vec<serde_json::Value> = resolution
                                .allowed_roots
                                .iter()
                                .map(|r| {
                                    let name =
                                        r.file_name().and_then(|n| n.to_str()).unwrap_or("");
                                    serde_json::json!({ "name": name, "is_dir": true })
                                })
                                .collect();
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
                            tool_list_directory_recursive(
                                &resolved,
                                &resolution.allowed_roots,
                            )?
                        } else {
                            tool_list_directory(&resolved, &resolution.allowed_roots)?
                        }
                    };

                    // For persona scope, filter entries to only show allowed files
                    if let Some(ref allowed_names) = resolution.allowed_filenames {
                        if let Some(entries) =
                            result.get_mut("entries").and_then(|v| v.as_array_mut())
                        {
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
                &browser
                    .sessions
                    .read()
                    .await
                    .get(conversation_id)
                    .map(|s| &s.last_ref_map),
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

        "http_request" => tool_http_request(app, input, conversation_id, db).await,

        // ── System tools ──
        "run_command" => {
            let workspace = super::scope::resolve_workspace_path(app, db, conversation_id)?;
            let default_dir = workspace.to_string_lossy().to_string();
            tool_run_command(input, &default_dir).await
        }

        // ── Self-awareness tools ──
        "self_inspect" => tool_self_inspect(app, db, conversation_id),
        "manage_schedule" => tool_manage_schedule(app, db, input, conversation_id),

        // ── Orchestration tools ──
        // These are not executed directly — the frontend/orchestrator intercepts them.
        // If they reach here, return a structured result indicating orchestration action.
        "delegate" | "report" => Ok(serde_json::json!({
            "orchestration": true,
            "tool": tool_name,
            "input": input,
        })),

        _ => Err(format!("Unknown tool: '{}'", tool_name)),
    }
}

/// Inner dispatch for agent-context execution (no conversation required).
/// Used by cron jobs and other backend-triggered tool calls.
/// Passes `agent_id` as the identifier — tools that support both conversation_id
/// and agent_id resolution (self_inspect, manage_schedule) handle this gracefully.
/// Tools that require a conversation (browser, workspace files) return clear errors.
pub(crate) async fn execute_tool_inner_for_agent(
    app: &AppHandle,
    db: &Database,
    tool_name: &str,
    input: &serde_json::Value,
    agent_id: &str,
) -> Result<serde_json::Value, String> {
    match tool_name {
        "self_inspect" => tool_self_inspect(app, db, agent_id),
        "manage_schedule" => tool_manage_schedule(app, db, input, agent_id),
        "web_search" => {
            let url = input
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("web_search: missing 'url' parameter")?;
            tool_web_search(url).await
        }
        "http_request" => {
            // Check if request uses credential placeholders — those require conversation context
            let input_str = serde_json::to_string(input).unwrap_or_default();
            if input_str.contains("{{credential:") {
                return Err("Credential-based HTTP requests are not supported in scheduled task execution. Use plain headers instead.".to_string());
            }
            tool_http_request(app, input, agent_id, db).await
        }
        "read_file" | "write_file" | "delete_file" | "list_directory" => {
            let scope = input
                .get("scope")
                .and_then(|v| v.as_str())
                .unwrap_or("workspace");
            if scope == "workspace" {
                return Err("Workspace scope is not available in scheduled task execution. Use 'persona' or 'vault' scope.".to_string());
            }
            // Resolve agent to build scope directly (no conversation needed)
            let agent = agent_operations::get_agent_impl(db, agent_id.to_string())
                .map_err(|e| format!("Failed to get agent: {e}"))?;
            validate_no_traversal(&agent.folder_name, "folder_name")?;
            let agents_dir = agents_dir(app)?;

            if scope == "persona" {
                let persona_dir = agents_dir.join(&agent.folder_name);
                let resolution = ScopeResolution {
                    root: persona_dir.clone(),
                    allowed_roots: vec![persona_dir],
                    allowed_filenames: Some(vec![
                        "IDENTITY.md",
                        "SOUL.md",
                        "USER.md",
                        "AGENTS.md",
                        "BOOT.md",
                    ]),
                    agent_id: agent_id.to_string(),
                };
                execute_file_tool_with_scope(app, tool_name, input, &resolution)
            } else {
                // vault scope — restrict to agent's own category dirs (matches interactive path)
                let vault = app.state::<VaultState>();
                let vault_path = {
                    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
                    vm.get_vault_path().to_path_buf()
                };
                let agent_vault = vault_path.join("agents").join(agent_id);
                let allowed_categories =
                    ["knowledge", "decision", "conversation", "reflection"];
                let mut allowed_roots = Vec::new();
                for cat in &allowed_categories {
                    let cat_dir = agent_vault.join(cat);
                    let _ = std::fs::create_dir_all(&cat_dir);
                    allowed_roots.push(cat_dir);
                }
                let resolution = ScopeResolution {
                    root: agent_vault,
                    allowed_roots,
                    allowed_filenames: None,
                    agent_id: agent_id.to_string(),
                };
                execute_file_tool_with_scope(app, tool_name, input, &resolution)
            }
        }
        "run_command" => {
            let default_dir = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| "/tmp".to_string());
            tool_run_command(input, &default_dir).await
        }
        t if t.starts_with("browser_") => {
            Err("Browser tools are not available in scheduled task execution.".to_string())
        }
        "delegate" | "report" => Err(format!(
            "Tool '{}' is not available in scheduled task execution.",
            tool_name
        )),
        _ => Err(format!("Unknown tool: '{}'", tool_name)),
    }
}

/// Execute a file tool (read/write/delete/list) with a pre-resolved scope.
/// Used by cron execution where conversation-based scope resolution is not available.
/// For vault scope, write/delete trigger vault index rebuild to maintain integrity.
pub(crate) fn execute_file_tool_with_scope(
    app: &AppHandle,
    tool_name: &str,
    input: &serde_json::Value,
    resolution: &ScopeResolution,
) -> Result<serde_json::Value, String> {
    let resolve_path_fn = |raw: &str| -> Result<String, String> {
        if let Some(ref allowed_names) = resolution.allowed_filenames {
            let name = std::path::Path::new(raw)
                .file_name()
                .and_then(|f| f.to_str())
                .ok_or_else(|| format!("Invalid filename: {raw}"))?;
            if !allowed_names.iter().any(|&a| a == name) {
                return Err(format!("File not allowed in this scope: {name}"));
            }
            Ok(resolution.root.join(name).to_string_lossy().to_string())
        } else {
            let resolved = resolution.root.join(raw);
            let resolved_str = resolved.to_string_lossy().to_string();
            validate_tool_roots(&resolved_str, &resolution.allowed_roots)?;
            Ok(resolved_str)
        }
    };

    match tool_name {
        "read_file" => {
            let raw_path = input["path"]
                .as_str()
                .ok_or("read_file: missing 'path'")?;
            let resolved = resolve_path_fn(raw_path)?;
            let content = std::fs::read_to_string(&resolved)
                .map_err(|e| format!("Failed to read file: {e}"))?;
            Ok(serde_json::json!({ "content": content, "path": resolved }))
        }
        "write_file" => {
            let raw_path = input["path"]
                .as_str()
                .ok_or("write_file: missing 'path'")?;
            let content = input["content"]
                .as_str()
                .ok_or("write_file: missing 'content'")?;
            let resolved = resolve_path_fn(raw_path)?;
            if let Some(parent) = std::path::Path::new(&resolved).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&resolved, content)
                .map_err(|e| format!("Failed to write file: {e}"))?;
            // Incrementally index if this is a vault write
            if resolution.allowed_filenames.is_none() {
                if let Err(e) = index_single_vault_note(app, &resolved) {
                    eprintln!("[vault-index] Failed to index after write: {e}");
                }
            }
            Ok(serde_json::json!({ "success": true, "path": resolved }))
        }
        "delete_file" => {
            let raw_path = input["path"]
                .as_str()
                .ok_or("delete_file: missing 'path'")?;
            let resolved = resolve_path_fn(raw_path)?;
            // Remove from vault index before deleting
            if resolution.allowed_filenames.is_none() {
                if let Err(e) = remove_vault_note_by_path(app, &resolved) {
                    eprintln!("[vault-index] Failed to remove from index before delete: {e}");
                }
            }
            std::fs::remove_file(&resolved)
                .map_err(|e| format!("Failed to delete file: {e}"))?;
            Ok(serde_json::json!({ "success": true, "path": resolved }))
        }
        "list_directory" => {
            let raw_path = input["path"]
                .as_str()
                .ok_or("list_directory: missing 'path'")?;
            let recursive = input["recursive"].as_bool().unwrap_or(false);

            // Special case: vault root listing (path is "." or empty)
            // Returns the allowed category directories, matching interactive behavior
            if (raw_path == "." || raw_path.is_empty()) && resolution.allowed_filenames.is_none() {
                let items: Vec<serde_json::Value> = resolution
                    .allowed_roots
                    .iter()
                    .filter_map(|r| r.file_name().map(|n| n.to_string_lossy().to_string()))
                    .map(|name| serde_json::json!({ "name": name, "is_dir": true }))
                    .collect();
                return Ok(serde_json::json!({ "entries": items, "path": resolution.root.to_string_lossy() }));
            }

            let resolved = resolve_path_fn(raw_path)?;

            fn collect_entries(
                dir: &str,
                recursive: bool,
                allowed_names: &Option<Vec<&'static str>>,
                allowed_roots: &[std::path::PathBuf],
            ) -> Result<Vec<serde_json::Value>, String> {
                let entries = std::fs::read_dir(dir)
                    .map_err(|e| format!("Failed to read directory: {e}"))?;
                let mut items: Vec<serde_json::Value> = Vec::new();
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if let Some(ref names) = allowed_names {
                        if !names.iter().any(|&a| a == name) {
                            continue;
                        }
                    }
                    let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    items.push(serde_json::json!({ "name": name, "is_dir": is_dir }));
                    if recursive && is_dir {
                        let sub_path = entry.path().to_string_lossy().to_string();
                        // Validate sub-path is still within allowed roots
                        if validate_tool_roots(&sub_path, allowed_roots).is_ok() {
                            if let Ok(sub_items) =
                                collect_entries(&sub_path, true, allowed_names, allowed_roots)
                            {
                                for mut sub in sub_items {
                                    if let Some(n) = sub.get("name").and_then(|v| v.as_str()) {
                                        sub["name"] = serde_json::json!(format!("{name}/{n}"));
                                    }
                                    items.push(sub);
                                }
                            }
                        }
                    }
                }
                Ok(items)
            }

            let items = collect_entries(
                &resolved,
                recursive,
                &resolution.allowed_filenames,
                &resolution.allowed_roots,
            )?;

            // Filter persona files if applicable
            Ok(serde_json::json!({ "entries": items, "path": resolved }))
        }
        _ => Err(format!("Not a file tool: {tool_name}")),
    }
}
