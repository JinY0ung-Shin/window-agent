use crate::commands::vault_commands::VaultState;
use crate::db::agent_operations;
use crate::db::{operations, Database};
use crate::error::AppError;
use crate::utils::path_security::{validate_no_traversal, validate_tool_roots};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use crate::utils::config_helpers::agents_dir;

/// Allowed persona files for the persona scope.
pub(super) const ALLOWED_PERSONA_FILES: &[&str] =
    &["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "BOOT.md"];

// ── Path security ──

/// Resolve and validate a path against allowed roots.
/// Delegates to utils::path_security::validate_tool_roots.
pub(super) fn validate_path(raw_path: &str, allowed_roots: &[PathBuf]) -> Result<PathBuf, String> {
    validate_tool_roots(raw_path, allowed_roots)
}

// ── Scope resolution ──

/// Resolved scope information for file tools.
pub(super) struct ScopeResolution {
    pub root: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
    /// If set, only these filenames are accessible (persona scope).
    pub allowed_filenames: Option<Vec<&'static str>>,
    /// The agent_id from the conversation (needed for vault operations).
    pub agent_id: String,
}

/// Resolve scope to root directory, allowed roots, and optional filename whitelist.
pub(super) fn resolve_scope(
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

            let agents_dir = agents_dir(app)?;
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
pub(super) fn resolve_workspace_path(
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
