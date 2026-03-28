use crate::api::ApiState;
use crate::error::AppError;
use crate::services::marketplace_service::{self, MarketplacePluginInfo, RemoteSkillInfo, InstallResult};
use crate::utils::config_helpers::agents_dir;
use crate::utils::path_security::validate_no_traversal;
use tauri::{AppHandle, Manager};

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
