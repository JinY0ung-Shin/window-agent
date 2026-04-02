use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

// ── GitHub marketplace types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceManifest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub plugins: Vec<MarketplacePlugin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplacePlugin {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub author: Option<PluginAuthor>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    pub source: PluginSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PluginSource {
    /// Local path relative to marketplace repo
    Local(String),
    /// Structured source (url, git-subdir, github)
    Structured(StructuredSource),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredSource {
    pub source: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default, rename = "ref")]
    pub git_ref: Option<String>,
    #[serde(default)]
    pub sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuthor {
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
}

/// Simplified plugin info returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplacePluginInfo {
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub keywords: Vec<String>,
    /// The GitHub owner/repo where the plugin lives
    pub repo_url: String,
    /// Branch or sha to fetch from
    pub git_ref: String,
    /// Subdirectory within the repo (empty for root)
    pub subpath: String,
    /// Whether this is a local (bundled) or external plugin
    pub source_type: String,
}

/// Skill file info fetched from a plugin repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSkillInfo {
    pub name: String,
    pub description: String,
    /// Path within the plugin repo (e.g. "skills/code-review/SKILL.md")
    pub path: String,
}

/// Result of installing a skill from marketplace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

// ── URL parsing ──

/// Parse a GitHub URL into (owner, repo, branch).
/// Supports:
///   - https://github.com/owner/repo
///   - https://github.com/owner/repo.git
///   - owner/repo
pub fn parse_github_url(input: &str) -> Result<(String, String), AppError> {
    let trimmed = input.trim().trim_end_matches('/').trim_end_matches(".git");

    // Try full URL
    if trimmed.contains("github.com") {
        let parts: Vec<&str> = trimmed.split("github.com/").collect();
        if parts.len() >= 2 {
            let path = parts[1];
            let segments: Vec<&str> = path.split('/').collect();
            if segments.len() >= 2 {
                return Ok((segments[0].to_string(), segments[1].to_string()));
            }
        }
        return Err(AppError::Validation(format!("Invalid GitHub URL: {}", input)));
    }

    // Try owner/repo shorthand
    let segments: Vec<&str> = trimmed.split('/').collect();
    if segments.len() == 2 && !segments[0].is_empty() && !segments[1].is_empty() {
        return Ok((segments[0].to_string(), segments[1].to_string()));
    }

    Err(AppError::Validation(format!(
        "Invalid GitHub URL or owner/repo: {}",
        input
    )))
}

/// Build raw.githubusercontent.com URL for a file.
pub fn raw_url(owner: &str, repo: &str, git_ref: &str, path: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        owner, repo, git_ref, path
    )
}

// ── Fetching ──

/// Fetch marketplace.json from a GitHub repo.
/// Returns (manifest, branch) so callers know the actual branch used.
pub async fn fetch_marketplace(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
) -> Result<(MarketplaceManifest, String), AppError> {
    let mut last_status = 0u16;

    // Try main branch first, then master
    for branch in &["main", "master"] {
        let url = raw_url(owner, repo, branch, ".claude-plugin/marketplace.json");
        let resp = client.get(&url).send().await?;
        let status = resp.status();

        if status.is_success() {
            let text = resp.text().await?;
            let manifest: MarketplaceManifest = serde_json::from_str(&text)
                .map_err(|e| AppError::Json(format!("Failed to parse marketplace.json: {}", e)))?;
            return Ok((manifest, branch.to_string()));
        }

        last_status = status.as_u16();

        // Don't retry on auth/rate-limit errors — they won't resolve on a different branch
        if status.as_u16() == 403 || status.as_u16() == 429 {
            return Err(AppError::Api(format!(
                "GitHub API error ({}): rate limited or access denied for {}/{}",
                status, owner, repo
            )));
        }
    }

    if last_status == 404 {
        Err(AppError::NotFound(format!(
            "marketplace.json not found in {}/{}",
            owner, repo
        )))
    } else {
        Err(AppError::Api(format!(
            "GitHub API error ({}) fetching marketplace.json from {}/{}",
            last_status, owner, repo
        )))
    }
}

/// Resolve a plugin's source into (repo_owner, repo_name, git_ref, subpath).
/// `marketplace_branch` is the actual branch discovered by `fetch_marketplace`.
pub fn resolve_plugin_source(
    marketplace_owner: &str,
    marketplace_repo: &str,
    marketplace_branch: &str,
    plugin: &MarketplacePlugin,
) -> (String, String, String, String) {
    match &plugin.source {
        PluginSource::Local(path) => {
            // Bundled plugin: lives in the marketplace repo itself
            let subpath = path.trim_start_matches("./").to_string();
            (
                marketplace_owner.to_string(),
                marketplace_repo.to_string(),
                marketplace_branch.to_string(),
                subpath,
            )
        }
        PluginSource::Structured(s) => {
            // For external repos, use "main" as default since we don't know their branch.
            // For marketplace-internal fallbacks, use the discovered marketplace branch.
            let external_default = || "main".to_string();
            let internal_default = || marketplace_branch.to_string();

            match s.source.as_str() {
                "url" => {
                    // Full git URL — points to an external repo
                    if let Some(url) = &s.url {
                        if let Ok((o, r)) = parse_github_url(url) {
                            let git_ref = s.sha.clone()
                                .or_else(|| s.git_ref.clone())
                                .unwrap_or_else(external_default);
                            return (o, r, git_ref, String::new());
                        }
                    }
                    (marketplace_owner.to_string(), marketplace_repo.to_string(), internal_default(), String::new())
                }
                "git-subdir" => {
                    let (o, r) = if let Some(url) = &s.url {
                        parse_github_url(url).unwrap_or_else(|_| (marketplace_owner.to_string(), marketplace_repo.to_string()))
                    } else {
                        (marketplace_owner.to_string(), marketplace_repo.to_string())
                    };
                    // If pointing to an external repo, use "main"; otherwise marketplace branch
                    let is_external = s.url.is_some();
                    let git_ref = s.sha.clone()
                        .or_else(|| s.git_ref.clone())
                        .unwrap_or_else(|| if is_external { "main".to_string() } else { marketplace_branch.to_string() });
                    let subpath = s.path.clone().unwrap_or_default();
                    (o, r, git_ref, subpath)
                }
                "github" => {
                    // Always external
                    if let Some(repo_str) = &s.repo {
                        if let Ok((o, r)) = parse_github_url(repo_str) {
                            let git_ref = s.sha.clone()
                                .or_else(|| s.git_ref.clone())
                                .unwrap_or_else(external_default);
                            return (o, r, git_ref, String::new());
                        }
                    }
                    (marketplace_owner.to_string(), marketplace_repo.to_string(), internal_default(), String::new())
                }
                _ => {
                    (marketplace_owner.to_string(), marketplace_repo.to_string(), internal_default(), String::new())
                }
            }
        }
    }
}

/// Build MarketplacePluginInfo list from manifest.
pub fn build_plugin_list(
    owner: &str,
    repo: &str,
    marketplace_branch: &str,
    manifest: &MarketplaceManifest,
) -> Vec<MarketplacePluginInfo> {
    manifest
        .plugins
        .iter()
        .map(|p| {
            let (repo_owner, repo_name, git_ref, subpath) =
                resolve_plugin_source(owner, repo, marketplace_branch, p);
            let repo_url = format!("https://github.com/{}/{}", repo_owner, repo_name);
            let source_type = match &p.source {
                PluginSource::Local(_) => "local",
                PluginSource::Structured(_) => "external",
            };
            MarketplacePluginInfo {
                name: p.name.clone(),
                description: p.description.clone(),
                category: p.category.clone(),
                author: p.author.as_ref().map(|a| a.name.clone()),
                version: p.version.clone(),
                homepage: p.homepage.clone(),
                keywords: p.keywords.clone().unwrap_or_default(),
                repo_url,
                git_ref,
                subpath,
                source_type: source_type.to_string(),
            }
        })
        .collect()
}

/// Fetch the list of skills inside a plugin repo.
/// Uses GitHub API to list contents of the skills/ directory.
pub async fn fetch_plugin_skills(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    git_ref: &str,
    subpath: &str,
) -> Result<Vec<RemoteSkillInfo>, AppError> {
    let skills_path = if subpath.is_empty() {
        "skills".to_string()
    } else {
        format!("{}/skills", subpath)
    };

    // Use GitHub API to list directory contents
    let api_url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
        owner, repo, skills_path, git_ref
    );

    let resp = client
        .get(&api_url)
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "WindowAgent/0.12")
        .send()
        .await?;

    let status = resp.status();
    if !status.is_success() {
        // 404 = no skills directory — return empty
        if status.as_u16() == 404 {
            return Ok(Vec::new());
        }
        // Surface rate limits and other errors
        return Err(AppError::Api(format!(
            "GitHub API error ({}) fetching skills from {}/{}",
            status, owner, repo
        )));
    }

    let entries: Vec<GithubContent> = resp.json().await
        .map_err(|e| AppError::Json(format!("Failed to parse GitHub API response: {}", e)))?;

    let mut skills = Vec::new();

    for entry in entries {
        if entry.content_type != "dir" {
            continue;
        }

        // Try to fetch SKILL.md from this subdirectory
        let skill_md_path = format!("{}/{}/SKILL.md", skills_path, entry.name);
        let skill_url = raw_url(owner, repo, git_ref, &skill_md_path);

        let skill_resp = client.get(&skill_url).send().await?;
        let skill_status = skill_resp.status();
        if !skill_status.is_success() {
            if skill_status.as_u16() == 404 {
                // No SKILL.md in this subdirectory — skip
                continue;
            }
            // Surface non-404 errors (rate limit, server error, etc.)
            return Err(AppError::Api(format!(
                "GitHub error ({}) fetching {}/SKILL.md",
                skill_status, entry.name
            )));
        }

        let content = skill_resp.text().await?;
        let parsed = crate::services::skill_service::parse_frontmatter(&content, &entry.name);
        let meta = crate::services::skill_service::build_metadata(
            &parsed.frontmatter,
            &entry.name,
            parsed.diagnostics,
        );

        skills.push(RemoteSkillInfo {
            name: meta.name,
            description: meta.description,
            path: skill_md_path,
        });
    }

    Ok(skills)
}

/// Fetch a single skill's SKILL.md content from GitHub.
pub async fn fetch_skill_content(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    git_ref: &str,
    skill_md_path: &str,
) -> Result<String, AppError> {
    let url = raw_url(owner, repo, git_ref, skill_md_path);
    let resp = client.get(&url).send().await?;

    if !resp.status().is_success() {
        return Err(AppError::NotFound(format!(
            "SKILL.md not found at {}",
            skill_md_path
        )));
    }

    resp.text()
        .await
        .map_err(|e| AppError::Api(format!("Failed to download SKILL.md: {}", e)))
}

/// Install a skill into the local agent's skills directory.
pub fn install_skill_to_dir(
    skills_dir: &Path,
    skill_name: &str,
    skill_content: &str,
) -> Result<(), AppError> {
    crate::services::skill_service::validate_skill_name(skill_name)?;

    let skill_dir = skills_dir.join(skill_name);

    if skill_dir.exists() {
        return Err(AppError::Validation(format!(
            "Skill '{}' already exists",
            skill_name
        )));
    }

    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| AppError::Io(format!("Failed to create skill directory: {}", e)))?;

    let skill_md = skill_dir.join("SKILL.md");
    std::fs::write(&skill_md, skill_content)
        .map_err(|e| AppError::Io(format!("Failed to write SKILL.md: {}", e)))?;

    Ok(())
}

// ── Local Claude Code plugin scanning ──

/// Entry in ~/.claude/plugins/installed_plugins.json
#[derive(Debug, Deserialize)]
struct InstalledPluginsFile {
    #[allow(dead_code)]
    version: u32,
    plugins: HashMap<String, Vec<InstalledPluginEntry>>,
}

#[derive(Debug, Deserialize)]
struct InstalledPluginEntry {
    #[allow(dead_code)]
    scope: String,
    #[serde(rename = "installPath")]
    install_path: String,
    version: String,
    #[allow(dead_code)]
    #[serde(rename = "installedAt")]
    installed_at: Option<String>,
    #[allow(dead_code)]
    #[serde(rename = "lastUpdated")]
    last_updated: Option<String>,
}

/// Info about a locally installed Claude Code plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPluginInfo {
    pub name: String,
    pub marketplace: String,
    pub version: String,
    pub install_path: String,
    pub skill_count: usize,
}

/// Read ~/.claude/plugins/installed_plugins.json and return plugin info.
pub fn list_local_cc_plugins() -> Result<Vec<LocalPluginInfo>, AppError> {
    let json_path = crate::utils::config_helpers::cc_plugins_dir()?
        .join("installed_plugins.json");

    if !json_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&json_path)
        .map_err(|e| AppError::Io(format!("Failed to read installed_plugins.json: {}", e)))?;

    let file: InstalledPluginsFile = serde_json::from_str(&content)
        .map_err(|e| AppError::Json(format!("Failed to parse installed_plugins.json: {}", e)))?;

    let mut plugins = Vec::new();

    for (key, entries) in &file.plugins {
        // key format: "plugin-name@marketplace-name"
        let parts: Vec<&str> = key.splitn(2, '@').collect();
        let (plugin_name, marketplace) = if parts.len() == 2 {
            (parts[0].to_string(), parts[1].to_string())
        } else {
            (key.clone(), "unknown".to_string())
        };

        // Use the first (most recent) entry
        if let Some(entry) = entries.first() {
            let install_path = &entry.install_path;
            let skills_dir = Path::new(install_path).join("skills");

            let skill_count = if skills_dir.is_dir() {
                count_skill_dirs(&skills_dir)
            } else {
                0
            };

            plugins.push(LocalPluginInfo {
                name: plugin_name,
                marketplace,
                version: entry.version.clone(),
                install_path: install_path.clone(),
                skill_count,
            });
        }
    }

    // Sort by name
    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(plugins)
}

/// Count subdirectories that contain SKILL.md.
fn count_skill_dirs(skills_dir: &Path) -> usize {
    std::fs::read_dir(skills_dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                        && e.path().join("SKILL.md").exists()
                })
                .count()
        })
        .unwrap_or(0)
}

/// List skills inside a local Claude Code plugin's cache directory.
pub fn list_local_cc_plugin_skills(install_path: &str) -> Result<Vec<RemoteSkillInfo>, AppError> {
    let skills_dir = Path::new(install_path).join("skills");

    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(&skills_dir)
        .map_err(|e| AppError::Io(format!("Failed to read skills directory: {}", e)))?;

    let mut skills = Vec::new();

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let skill_md = entry.path().join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&skill_md) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let parsed = crate::services::skill_service::parse_frontmatter(&content, &dir_name);
        let meta = crate::services::skill_service::build_metadata(
            &parsed.frontmatter,
            &dir_name,
            parsed.diagnostics,
        );

        skills.push(RemoteSkillInfo {
            name: meta.name,
            description: meta.description,
            path: skill_md.to_string_lossy().to_string(),
        });
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

/// Install skills from a local Claude Code plugin cache into agent skills directory.
pub fn install_local_cc_skills(
    agent_skills_dir: &Path,
    skills: &[RemoteSkillInfo],
) -> Result<InstallResult, AppError> {
    std::fs::create_dir_all(agent_skills_dir)
        .map_err(|e| AppError::Io(format!("Failed to create skills dir: {}", e)))?;

    let mut result = InstallResult {
        installed: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    for skill in skills {
        // Check duplicate
        if agent_skills_dir.join(&skill.name).exists() {
            result.skipped.push(skill.name.clone());
            continue;
        }

        // skill.path is the absolute path to SKILL.md in the plugin cache
        let source_path = Path::new(&skill.path);
        if !source_path.exists() {
            result.errors.push(format!("{}: SKILL.md not found", skill.name));
            continue;
        }

        match std::fs::read_to_string(source_path) {
            Ok(content) => {
                match install_skill_to_dir(agent_skills_dir, &skill.name, &content) {
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

// ── GitHub API types ──

#[derive(Debug, Deserialize)]
struct GithubContent {
    name: String,
    #[serde(rename = "type")]
    content_type: String,
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_github_url_full() {
        let (owner, repo) = parse_github_url("https://github.com/anthropics/claude-plugins-official").unwrap();
        assert_eq!(owner, "anthropics");
        assert_eq!(repo, "claude-plugins-official");
    }

    #[test]
    fn test_parse_github_url_with_git() {
        let (owner, repo) = parse_github_url("https://github.com/owner/repo.git").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_github_url_shorthand() {
        let (owner, repo) = parse_github_url("anthropics/claude-plugins-official").unwrap();
        assert_eq!(owner, "anthropics");
        assert_eq!(repo, "claude-plugins-official");
    }

    #[test]
    fn test_parse_github_url_trailing_slash() {
        let (owner, repo) = parse_github_url("https://github.com/owner/repo/").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_github_url_invalid() {
        assert!(parse_github_url("not-valid").is_err());
        assert!(parse_github_url("").is_err());
    }

    #[test]
    fn test_raw_url() {
        let url = raw_url("anthropics", "repo", "main", "skills/test/SKILL.md");
        assert_eq!(url, "https://raw.githubusercontent.com/anthropics/repo/main/skills/test/SKILL.md");
    }

    #[test]
    fn test_resolve_local_source() {
        let plugin = MarketplacePlugin {
            name: "test".to_string(),
            description: "desc".to_string(),
            category: None,
            homepage: None,
            author: None,
            version: None,
            keywords: None,
            source: PluginSource::Local("./plugins/test".to_string()),
        };
        let (o, r, git_ref, sub) = resolve_plugin_source("owner", "repo", "main", &plugin);
        assert_eq!(o, "owner");
        assert_eq!(r, "repo");
        assert_eq!(git_ref, "main");
        assert_eq!(sub, "plugins/test");
    }

    #[test]
    fn test_resolve_url_source() {
        let plugin = MarketplacePlugin {
            name: "test".to_string(),
            description: "desc".to_string(),
            category: None,
            homepage: None,
            author: None,
            version: None,
            keywords: None,
            source: PluginSource::Structured(StructuredSource {
                source: "url".to_string(),
                url: Some("https://github.com/ext/plugin.git".to_string()),
                repo: None,
                path: None,
                git_ref: None,
                sha: Some("abc123".to_string()),
            }),
        };
        let (o, r, git_ref, _sub) = resolve_plugin_source("owner", "repo", "main", &plugin);
        assert_eq!(o, "ext");
        assert_eq!(r, "plugin");
        assert_eq!(git_ref, "abc123");
    }

    #[test]
    fn test_resolve_github_source() {
        let plugin = MarketplacePlugin {
            name: "test".to_string(),
            description: "desc".to_string(),
            category: None,
            homepage: None,
            author: None,
            version: None,
            keywords: None,
            source: PluginSource::Structured(StructuredSource {
                source: "github".to_string(),
                url: None,
                repo: Some("someone/their-plugin".to_string()),
                path: None,
                git_ref: None,
                sha: None,
            }),
        };
        let (o, r, _git_ref, _sub) = resolve_plugin_source("owner", "repo", "main", &plugin);
        assert_eq!(o, "someone");
        assert_eq!(r, "their-plugin");
    }

    #[test]
    fn test_install_skill_to_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        let content = "---\nname: test-skill\ndescription: A test\n---\n\nBody";
        install_skill_to_dir(&skills_dir, "test-skill", content).unwrap();

        let installed = skills_dir.join("test-skill").join("SKILL.md");
        assert!(installed.exists());
        assert_eq!(std::fs::read_to_string(installed).unwrap(), content);
    }

    #[test]
    fn test_install_skill_duplicate() {
        let tmp = tempfile::TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        std::fs::create_dir_all(skills_dir.join("existing")).unwrap();

        let result = install_skill_to_dir(&skills_dir, "existing", "content");
        assert!(result.is_err());
    }

    #[test]
    fn test_build_plugin_list() {
        let manifest = MarketplaceManifest {
            name: Some("test".to_string()),
            description: None,
            plugins: vec![
                MarketplacePlugin {
                    name: "plugin-a".to_string(),
                    description: "Desc A".to_string(),
                    category: Some("dev".to_string()),
                    homepage: None,
                    author: Some(PluginAuthor { name: "Author".to_string(), email: None }),
                    version: Some("1.0.0".to_string()),
                    keywords: None,
                    source: PluginSource::Local("./plugins/plugin-a".to_string()),
                },
            ],
        };
        let list = build_plugin_list("owner", "repo", "main", &manifest);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "plugin-a");
        assert_eq!(list[0].source_type, "local");
        assert_eq!(list[0].subpath, "plugins/plugin-a");
    }
}
