use crate::api::ApiState;
use crate::db::Database;
use crate::db::agent_operations;
use crate::error::AppError;
use crate::services::{marketplace_service::{self, MarketplacePluginInfo, RemoteSkillInfo, InstallResult, LocalPluginInfo}, skill_service};
use crate::utils::config_helpers::agents_dir;
use crate::utils::path_security::validate_no_traversal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

/// Validate that a path is within the Claude Code plugins cache directory.
fn validate_cc_plugin_path(path: &str) -> Result<(), AppError> {
    let home = std::env::var("HOME")
        .map_err(|_| AppError::Io("HOME not set".to_string()))?;
    let allowed = Path::new(&home).join(".claude/plugins");
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| AppError::Validation(format!("Invalid path: {}", e)))?;
    if !canonical.starts_with(&allowed) {
        return Err(AppError::Validation(format!(
            "Path must be within ~/.claude/plugins/: {}",
            path
        )));
    }
    Ok(())
}

// ── Tauri commands ──

/// Fetch the plugin list from a GitHub marketplace repo.
#[tauri::command]
pub async fn marketplace_fetch_plugins(
    app: AppHandle,
    github_url: String,
) -> Result<Vec<MarketplacePluginInfo>, AppError> {
    let (owner, repo) = marketplace_service::parse_github_url(&github_url)?;
    let api_state = app.state::<ApiState>();
    let client = api_state.client()?;

    let (manifest, branch) = marketplace_service::fetch_marketplace(&client, &owner, &repo).await?;
    let plugins = marketplace_service::build_plugin_list(&owner, &repo, &branch, &manifest);
    Ok(plugins)
}

/// Fetch the skills available in a specific plugin.
#[tauri::command]
pub async fn marketplace_fetch_plugin_skills(
    app: AppHandle,
    repo_url: String,
    git_ref: String,
    subpath: String,
) -> Result<Vec<RemoteSkillInfo>, AppError> {
    let (owner, repo) = marketplace_service::parse_github_url(&repo_url)?;
    let api_state = app.state::<ApiState>();
    let client = api_state.client()?;

    marketplace_service::fetch_plugin_skills(&client, &owner, &repo, &git_ref, &subpath).await
}

/// Install selected skills from a plugin into an agent's skills directory.
#[tauri::command]
pub async fn marketplace_install_skills(
    app: AppHandle,
    folder_name: String,
    repo_url: String,
    git_ref: String,
    skills: Vec<RemoteSkillInfo>,
) -> Result<InstallResult, AppError> {
    // Security: validate folder_name to prevent path traversal
    validate_no_traversal(&folder_name, "folder_name").map_err(AppError::Validation)?;

    let (owner, repo) = marketplace_service::parse_github_url(&repo_url)?;
    let api_state = app.state::<ApiState>();
    let client = api_state.client()?;

    let agent_skills_dir = agents_dir(&app)?.join(&folder_name).join("skills");
    std::fs::create_dir_all(&agent_skills_dir)
        .map_err(|e| AppError::Io(format!("Failed to create skills dir: {}", e)))?;

    let mut result = InstallResult {
        installed: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    for skill in &skills {
        // Check if already exists
        if agent_skills_dir.join(&skill.name).exists() {
            result.skipped.push(skill.name.clone());
            continue;
        }

        match marketplace_service::fetch_skill_content(
            &client, &owner, &repo, &git_ref, &skill.path,
        )
        .await
        {
            Ok(content) => {
                match marketplace_service::install_skill_to_dir(
                    &agent_skills_dir,
                    &skill.name,
                    &content,
                ) {
                    Ok(()) => result.installed.push(skill.name.clone()),
                    Err(e) => result.errors.push(format!("{}: {}", skill.name, e)),
                }
            }
            Err(e) => {
                result.errors.push(format!("{}: {}", skill.name, e));
            }
        }
    }

    Ok(result)
}

// ── Local Claude Code plugin commands ──

/// List locally installed Claude Code plugins that have skills.
#[tauri::command]
pub fn local_cc_plugins_list() -> Result<Vec<LocalPluginInfo>, AppError> {
    marketplace_service::list_local_cc_plugins()
}

/// List skills inside a locally installed Claude Code plugin.
#[tauri::command]
pub fn local_cc_plugin_skills(
    install_path: String,
) -> Result<Vec<RemoteSkillInfo>, AppError> {
    validate_cc_plugin_path(&install_path)?;
    marketplace_service::list_local_cc_plugin_skills(&install_path)
}

/// Install selected skills from a local Claude Code plugin into an agent's skills directory.
#[tauri::command]
pub fn local_cc_install_skills(
    app: AppHandle,
    folder_name: String,
    skills: Vec<RemoteSkillInfo>,
) -> Result<InstallResult, AppError> {
    validate_no_traversal(&folder_name, "folder_name").map_err(AppError::Validation)?;

    let agent_skills_dir = agents_dir(&app)?.join(&folder_name).join("skills");
    marketplace_service::install_local_cc_skills(&agent_skills_dir, &skills)
}

// ── Skill matrix commands (cross-agent skill management) ──

/// Minimal agent info for the matrix UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentBrief {
    pub id: String,
    pub name: String,
    pub folder_name: String,
}

/// Which agents have which skills installed.
/// Key: skill_name, Value: list of folder_names that have it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMatrix {
    pub agents: Vec<AgentBrief>,
    pub matrix: HashMap<String, Vec<String>>,
}

/// Get the skill installation matrix: for each skill name, which agents have it.
#[tauri::command]
pub fn skill_matrix(
    app: AppHandle,
    db: State<'_, Database>,
    skill_names: Vec<String>,
) -> Result<SkillMatrix, AppError> {
    let agents = agent_operations::list_agents_impl(&db)?;
    let agents_dir_path = agents_dir(&app)?;

    let agent_briefs: Vec<AgentBrief> = agents
        .iter()
        .filter(|a| !a.is_default)
        .map(|a| AgentBrief {
            id: a.id.clone(),
            name: a.name.clone(),
            folder_name: a.folder_name.clone(),
        })
        .collect();

    let mut matrix: HashMap<String, Vec<String>> = HashMap::new();

    for skill_name in &skill_names {
        // Validate skill name to prevent filesystem probing via traversal
        if let Err(_) = skill_service::validate_skill_name(skill_name) {
            continue;
        }
        let mut has_it = Vec::new();
        for agent in &agent_briefs {
            let skill_dir = agents_dir_path
                .join(&agent.folder_name)
                .join("skills")
                .join(skill_name);
            if skill_dir.join("SKILL.md").exists() {
                has_it.push(agent.folder_name.clone());
            }
        }
        matrix.insert(skill_name.clone(), has_it);
    }

    Ok(SkillMatrix {
        agents: agent_briefs,
        matrix,
    })
}

/// Batch assign/unassign skills to multiple agents.
#[derive(Debug, Clone, Deserialize)]
pub struct SkillAssignment {
    pub skill_name: String,
    /// Source path to SKILL.md (absolute, from local CC plugin cache)
    pub source_path: String,
    /// folder_names to install to
    pub add_to: Vec<String>,
    /// folder_names to remove from
    pub remove_from: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchResult {
    pub installed: Vec<String>,
    pub removed: Vec<String>,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn skill_matrix_apply(
    app: AppHandle,
    assignments: Vec<SkillAssignment>,
) -> Result<BatchResult, AppError> {
    let agents_dir_path = agents_dir(&app)?;
    let mut result = BatchResult {
        installed: Vec::new(),
        removed: Vec::new(),
        errors: Vec::new(),
    };

    for assign in &assignments {
        // Validate skill name to prevent path traversal in both install and remove
        if let Err(e) = skill_service::validate_skill_name(&assign.skill_name) {
            result.errors.push(format!("{}: {}", assign.skill_name, e));
            continue;
        }

        // Validate source_path is within CC plugins cache
        if !assign.add_to.is_empty() {
            if let Err(e) = validate_cc_plugin_path(&assign.source_path) {
                result.errors.push(format!("{}: {}", assign.skill_name, e));
                continue;
            }
        }

        // Install to agents
        for folder in &assign.add_to {
            if let Err(e) = validate_no_traversal(folder, "folder_name") {
                result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e));
                continue;
            }
            let agent_skills_dir = agents_dir_path.join(folder).join("skills");
            let target = agent_skills_dir.join(&assign.skill_name);
            if target.exists() {
                continue; // already installed, skip silently
            }

            // Read source
            let source = std::path::Path::new(&assign.source_path);
            match std::fs::read_to_string(source) {
                Ok(content) => {
                    if let Err(e) = std::fs::create_dir_all(&agent_skills_dir) {
                        result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e));
                        continue;
                    }
                    match marketplace_service::install_skill_to_dir(
                        &agent_skills_dir,
                        &assign.skill_name,
                        &content,
                    ) {
                        Ok(()) => result.installed.push(format!("{}/{}", folder, assign.skill_name)),
                        Err(e) => result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e)),
                    }
                }
                Err(e) => {
                    result.errors.push(format!("{}/{}: source read failed: {}", folder, assign.skill_name, e));
                }
            }
        }

        // Remove from agents
        for folder in &assign.remove_from {
            if let Err(e) = validate_no_traversal(folder, "folder_name") {
                result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e));
                continue;
            }
            let target = agents_dir_path
                .join(folder)
                .join("skills")
                .join(&assign.skill_name);
            if !target.exists() {
                continue; // not installed, skip
            }
            match std::fs::remove_dir_all(&target) {
                Ok(()) => result.removed.push(format!("{}/{}", folder, assign.skill_name)),
                Err(e) => result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e)),
            }
        }
    }

    Ok(result)
}
