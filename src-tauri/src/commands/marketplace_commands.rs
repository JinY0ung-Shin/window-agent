use crate::api::ApiState;
use crate::db::Database;
use crate::db::agent_operations;
use crate::error::AppError;
use crate::services::{marketplace_service::{self, MarketplacePluginInfo, RemoteSkillInfo, InstallResult, LocalPluginInfo}, skill_service};
use crate::utils::config_helpers::{agents_dir, cc_plugins_dir};
use crate::utils::path_security::{validate_no_traversal, validate_tool_roots};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Manager, State};

fn validate_cc_plugin_path(path: &str) -> Result<(), AppError> {
    let allowed = vec![cc_plugins_dir()?];
    validate_tool_roots(path, &allowed)
        .map(|_| ())
        .map_err(AppError::Validation)
}

// ── Tauri commands ──

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

#[tauri::command]
pub async fn marketplace_install_skills(
    app: AppHandle,
    folder_name: String,
    repo_url: String,
    git_ref: String,
    skills: Vec<RemoteSkillInfo>,
) -> Result<InstallResult, AppError> {
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

#[tauri::command]
pub fn local_cc_plugins_list() -> Result<Vec<LocalPluginInfo>, AppError> {
    marketplace_service::list_local_cc_plugins()
}

#[tauri::command]
pub fn local_cc_plugin_skills(
    install_path: String,
) -> Result<Vec<RemoteSkillInfo>, AppError> {
    validate_cc_plugin_path(&install_path)?;
    marketplace_service::list_local_cc_plugin_skills(&install_path)
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentBrief {
    pub id: String,
    pub name: String,
    pub folder_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMatrix {
    pub agents: Vec<AgentBrief>,
    pub matrix: HashMap<String, Vec<String>>,
}

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

    // Validate skill names upfront, collect valid ones
    let valid_skills: Vec<&String> = skill_names
        .iter()
        .filter(|name| skill_service::validate_skill_name(name).is_ok())
        .collect();

    // Build per-agent installed skill sets via single read_dir (avoids O(S*A) stat calls)
    let mut agent_skill_sets: HashMap<String, HashSet<String>> = HashMap::new();
    for agent in &agent_briefs {
        let skills_dir = agents_dir_path.join(&agent.folder_name).join("skills");
        let mut installed = HashSet::new();
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && entry.path().join("SKILL.md").exists()
                {
                    installed.insert(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
        agent_skill_sets.insert(agent.folder_name.clone(), installed);
    }

    let mut matrix: HashMap<String, Vec<String>> = HashMap::new();
    for skill_name in &valid_skills {
        let has_it: Vec<String> = agent_briefs
            .iter()
            .filter(|a| {
                agent_skill_sets
                    .get(&a.folder_name)
                    .map(|set| set.contains(skill_name.as_str()))
                    .unwrap_or(false)
            })
            .map(|a| a.folder_name.clone())
            .collect();
        matrix.insert(skill_name.to_string(), has_it);
    }

    Ok(SkillMatrix {
        agents: agent_briefs,
        matrix,
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct SkillAssignment {
    pub skill_name: String,
    pub source_path: String,
    pub add_to: Vec<String>,
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
        if let Err(e) = skill_service::validate_skill_name(&assign.skill_name) {
            result.errors.push(format!("{}: {}", assign.skill_name, e));
            continue;
        }

        // Read source content once per assignment (not per agent)
        let source_content = if !assign.add_to.is_empty() {
            if let Err(e) = validate_cc_plugin_path(&assign.source_path) {
                result.errors.push(format!("{}: {}", assign.skill_name, e));
                continue;
            }
            match std::fs::read_to_string(&assign.source_path) {
                Ok(content) => Some(content),
                Err(e) => {
                    result.errors.push(format!("{}: source read failed: {}", assign.skill_name, e));
                    continue;
                }
            }
        } else {
            None
        };

        for folder in &assign.add_to {
            if let Err(e) = validate_no_traversal(folder, "folder_name") {
                result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e));
                continue;
            }
            let agent_skills_dir = agents_dir_path.join(folder).join("skills");
            if let Err(e) = std::fs::create_dir_all(&agent_skills_dir) {
                result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e));
                continue;
            }
            match marketplace_service::install_skill_to_dir(
                &agent_skills_dir,
                &assign.skill_name,
                source_content.as_deref().unwrap_or(""),
            ) {
                Ok(()) => result.installed.push(format!("{}/{}", folder, assign.skill_name)),
                Err(AppError::Validation(_)) => {} // already exists, skip
                Err(e) => result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e)),
            }
        }

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
                continue;
            }
            match std::fs::remove_dir_all(&target) {
                Ok(()) => result.removed.push(format!("{}/{}", folder, assign.skill_name)),
                Err(e) => result.errors.push(format!("{}/{}: {}", folder, assign.skill_name, e)),
            }
        }
    }

    Ok(result)
}
