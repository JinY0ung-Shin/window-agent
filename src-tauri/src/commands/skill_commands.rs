use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// ── Data structures ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub compatibility: Option<String>,
    pub license: Option<String>,
    pub metadata_map: Option<HashMap<String, String>>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillContent {
    pub metadata: SkillMetadata,
    pub body: String,
    pub raw_content: String,
    pub resource_files: Vec<String>,
}

// ── YAML frontmatter types (internal) ──

#[derive(Debug, Deserialize, Default)]
struct SkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
    compatibility: Option<String>,
    license: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, serde_yaml::Value>,
}

// ── Path helpers ──

fn get_agents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_dir.join("agents"))
}

fn get_agent_skills_dir(app: &AppHandle, folder_name: &str) -> Result<PathBuf, String> {
    Ok(get_agents_dir(app)?.join(folder_name).join("skills"))
}

fn get_global_skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_dir.join("skills"))
}

/// Validate a folder/skill name to prevent path traversal.
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err(format!("Invalid name: {}", name));
    }
    Ok(())
}

/// Validate a skill name: lowercase alphanumeric + hyphens, 1-64 chars.
fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err(format!(
            "Skill name must be 1-64 characters, got {}",
            name.len()
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!(
            "Skill name must contain only lowercase alphanumeric characters and hyphens: {}",
            name
        ));
    }
    Ok(())
}

/// Validate that a resolved path is within an allowed root.
fn validate_path_within(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let canonical = if path.exists() {
        std::fs::canonicalize(path).map_err(|e| format!("Cannot resolve path '{}': {}", path.display(), e))?
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| format!("Invalid path: {}", path.display()))?;
        if !parent.exists() {
            // Parent doesn't exist yet, do component-level check
            return validate_path_components(path, root);
        }
        let canonical_parent = std::fs::canonicalize(parent)
            .map_err(|e| format!("Cannot resolve parent of '{}': {}", path.display(), e))?;
        canonical_parent.join(
            path.file_name()
                .ok_or_else(|| format!("Invalid file name in path: {}", path.display()))?,
        )
    };

    let canonical_root = if root.exists() {
        std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
    } else {
        root.to_path_buf()
    };

    if canonical.starts_with(&canonical_root) {
        Ok(canonical)
    } else {
        Err(format!(
            "Path '{}' is outside allowed directory",
            path.display()
        ))
    }
}

/// Fallback path validation when parent doesn't exist yet.
/// Checks that no component is ".." and the path starts with root.
fn validate_path_components(path: &Path, root: &Path) -> Result<PathBuf, String> {
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err(format!("Path traversal detected in: {}", path.display()));
        }
    }
    if path.starts_with(root) {
        Ok(path.to_path_buf())
    } else {
        Err(format!(
            "Path '{}' is outside allowed directory",
            path.display()
        ))
    }
}

/// Resolve a skill directory, checking agent dir first then global.
fn resolve_skill_dir(
    app: &AppHandle,
    folder_name: &str,
    skill_name: &str,
) -> Result<PathBuf, String> {
    validate_name(folder_name)?;
    validate_name(skill_name)?;

    let agent_skill = get_agent_skills_dir(app, folder_name)?.join(skill_name);
    if agent_skill.exists() && agent_skill.join("SKILL.md").exists() {
        return Ok(agent_skill);
    }

    let global_skill = get_global_skills_dir(app)?.join(skill_name);
    if global_skill.exists() && global_skill.join("SKILL.md").exists() {
        return Ok(global_skill);
    }

    Err(format!("Skill '{}' not found", skill_name))
}

// ── Frontmatter parsing ──

/// Parse SKILL.md content into frontmatter + body.
fn parse_skill_md(content: &str, dir_name: &str) -> (SkillFrontmatter, String, Vec<String>) {
    let mut diagnostics = Vec::new();

    // Try to split on --- delimiters
    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() >= 3 && parts[0].trim().is_empty() {
        // Valid frontmatter structure: empty --- yaml --- body
        let yaml_str = parts[1];
        let body = parts[2].to_string();

        match serde_yaml::from_str::<SkillFrontmatter>(yaml_str) {
            Ok(fm) => (fm, body, diagnostics),
            Err(e) => {
                diagnostics.push(format!("YAML 파싱 실패: {}", e));
                let fallback = SkillFrontmatter {
                    name: Some(dir_name.to_string()),
                    description: Some("(설명 없음)".to_string()),
                    ..Default::default()
                };
                (fallback, body, diagnostics)
            }
        }
    } else {
        diagnostics.push("프론트매터를 찾을 수 없습니다".to_string());
        let fallback = SkillFrontmatter {
            name: Some(dir_name.to_string()),
            description: Some("(설명 없음)".to_string()),
            ..Default::default()
        };
        (fallback, content.to_string(), diagnostics)
    }
}

/// Build SkillMetadata from parsed frontmatter.
fn build_metadata(
    fm: &SkillFrontmatter,
    dir_name: &str,
    source: &str,
    path: &str,
    mut diagnostics: Vec<String>,
) -> SkillMetadata {
    let raw_name = fm.name.clone().unwrap_or_else(|| {
        diagnostics.push("이름 필드가 없어 디렉토리 이름을 사용합니다".to_string());
        dir_name.to_string()
    });

    // Lenient name normalization
    let normalized = raw_name.trim().to_lowercase();
    if normalized != raw_name {
        diagnostics.push(format!(
            "이름이 정규화되었습니다: '{}' → '{}'",
            raw_name, normalized
        ));
    }

    let description = fm.description.clone().unwrap_or_else(|| {
        diagnostics.push("설명 필드가 없습니다".to_string());
        "(설명 없음)".to_string()
    });

    // Collect extra fields into metadata_map
    let metadata_map = if fm.extra.is_empty() {
        None
    } else {
        let map: HashMap<String, String> = fm
            .extra
            .iter()
            .map(|(k, v)| {
                let val = match v {
                    serde_yaml::Value::String(s) => s.clone(),
                    serde_yaml::Value::Number(n) => n.to_string(),
                    serde_yaml::Value::Bool(b) => b.to_string(),
                    serde_yaml::Value::Null => "null".to_string(),
                    other => format!("{:?}", other),
                };
                (k.clone(), val)
            })
            .collect();
        Some(map)
    };

    SkillMetadata {
        name: normalized,
        description,
        source: source.to_string(),
        path: path.to_string(),
        compatibility: fm.compatibility.clone(),
        license: fm.license.clone(),
        metadata_map,
        diagnostics,
    }
}

/// Enumerate resource files from scripts/, references/, assets/ subdirs.
fn enumerate_resource_files(skill_dir: &Path) -> Vec<String> {
    let subdirs = ["scripts", "references", "assets"];
    let mut files = Vec::new();

    for subdir in &subdirs {
        let dir = skill_dir.join(subdir);
        if dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                        let relative = format!(
                            "{}/{}",
                            subdir,
                            entry.file_name().to_string_lossy()
                        );
                        files.push(relative);
                    }
                }
            }
        }
    }

    files.sort();
    files
}

// ── Tauri commands ──

#[tauri::command]
pub fn list_skills(
    app: AppHandle,
    folder_name: String,
) -> Result<Vec<SkillMetadata>, String> {
    validate_name(&folder_name)?;

    let mut skills: HashMap<String, SkillMetadata> = HashMap::new();

    // Scan global skills first
    let global_dir = get_global_skills_dir(&app)?;
    if global_dir.is_dir() {
        scan_skills_dir(&global_dir, "global", &mut skills)?;
    }

    // Scan agent skills (overrides global on name conflict)
    let agent_dir = get_agent_skills_dir(&app, &folder_name)?;
    if agent_dir.is_dir() {
        scan_skills_dir(&agent_dir, "agent", &mut skills)?;
    }

    let mut result: Vec<SkillMetadata> = skills.into_values().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

fn scan_skills_dir(
    dir: &Path,
    source: &str,
    skills: &mut HashMap<String, SkillMetadata>,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let skill_md_path = entry.path().join("SKILL.md");

        if !skill_md_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&skill_md_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let (fm, _body, diagnostics) = parse_skill_md(&content, &dir_name);
        let metadata = build_metadata(
            &fm,
            &dir_name,
            source,
            &entry.path().to_string_lossy(),
            diagnostics,
        );

        skills.insert(metadata.name.clone(), metadata);
    }

    Ok(())
}

#[tauri::command]
pub fn read_skill(
    app: AppHandle,
    folder_name: String,
    skill_name: String,
) -> Result<SkillContent, String> {
    let skill_dir = resolve_skill_dir(&app, &folder_name, &skill_name)?;
    let skill_md_path = skill_dir.join("SKILL.md");

    let content = std::fs::read_to_string(&skill_md_path)
        .map_err(|e| format!("Failed to read SKILL.md: {}", e))?;

    let dir_name = skill_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| skill_name.clone());

    let source = if skill_dir
        .to_string_lossy()
        .contains("/agents/")
    {
        "agent"
    } else {
        "global"
    };

    let (fm, body, diagnostics) = parse_skill_md(&content, &dir_name);
    let metadata = build_metadata(
        &fm,
        &dir_name,
        source,
        &skill_dir.to_string_lossy(),
        diagnostics,
    );
    let resource_files = enumerate_resource_files(&skill_dir);

    Ok(SkillContent {
        metadata,
        body,
        raw_content: content,
        resource_files,
    })
}

#[tauri::command]
pub fn read_skill_resource(
    app: AppHandle,
    folder_name: String,
    skill_name: String,
    resource_path: String,
) -> Result<String, String> {
    let skill_dir = resolve_skill_dir(&app, &folder_name, &skill_name)?;

    // Validate resource_path doesn't contain traversal
    if resource_path.contains("..") || resource_path.starts_with('/') || resource_path.starts_with('\\') {
        return Err("Invalid resource path".to_string());
    }

    let full_path = skill_dir.join(&resource_path);

    // Validate path is within the skill directory (not just app_data_dir)
    validate_path_within(&full_path, &skill_dir)?;

    std::fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read resource '{}': {}", resource_path, e))
}

#[tauri::command]
pub fn create_skill(
    app: AppHandle,
    folder_name: String,
    skill_name: String,
) -> Result<SkillMetadata, String> {
    validate_name(&folder_name)?;
    validate_skill_name(&skill_name)?;

    let skills_dir = get_agent_skills_dir(&app, &folder_name)?;
    let skill_dir = skills_dir.join(&skill_name);

    if skill_dir.exists() {
        return Err(format!("Skill '{}' already exists", skill_name));
    }

    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    let template = format!(
        "---\nname: {}\ndescription: 새 특기에 대한 설명을 입력하세요.\n---\n\n# {}\n\n여기에 에이전트가 따를 지침을 작성하세요.\n",
        skill_name, skill_name
    );

    let skill_md = skill_dir.join("SKILL.md");
    std::fs::write(&skill_md, &template)
        .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    // Parse back the template to return metadata
    let (fm, _body, diagnostics) = parse_skill_md(&template, &skill_name);
    let metadata = build_metadata(
        &fm,
        &skill_name,
        "agent",
        &skill_dir.to_string_lossy(),
        diagnostics,
    );

    Ok(metadata)
}

#[tauri::command]
pub fn update_skill(
    app: AppHandle,
    folder_name: String,
    skill_name: String,
    content: String,
) -> Result<SkillContent, String> {
    validate_name(&folder_name)?;
    validate_name(&skill_name)?;

    // Only operate on agent-scoped skills, never fall back to global
    let skill_dir = get_agent_skills_dir(&app, &folder_name)?.join(&skill_name);
    if !skill_dir.exists() {
        return Err(format!("Agent skill '{}' not found (global skills cannot be modified from agent editor)", skill_name));
    }

    let skill_md = skill_dir.join("SKILL.md");

    // Validate path
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    validate_path_within(&skill_md, &app_dir)?;

    std::fs::write(&skill_md, &content)
        .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    let dir_name = skill_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| skill_name.clone());

    let (fm, body, diagnostics) = parse_skill_md(&content, &dir_name);
    let metadata = build_metadata(
        &fm,
        &dir_name,
        "agent",
        &skill_dir.to_string_lossy(),
        diagnostics,
    );
    let resource_files = enumerate_resource_files(&skill_dir);

    Ok(SkillContent {
        metadata,
        body,
        raw_content: content,
        resource_files,
    })
}

#[tauri::command]
pub fn delete_skill(
    app: AppHandle,
    folder_name: String,
    skill_name: String,
) -> Result<(), String> {
    validate_name(&folder_name)?;
    validate_name(&skill_name)?;

    // Only operate on agent-scoped skills, never fall back to global
    let skill_dir = get_agent_skills_dir(&app, &folder_name)?.join(&skill_name);
    if !skill_dir.exists() {
        return Err(format!("Agent skill '{}' not found (global skills cannot be deleted from agent editor)", skill_name));
    }

    // Validate path is within app data dir
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    validate_path_within(&skill_dir, &app_dir)?;

    std::fs::remove_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to delete skill: {}", e))?;

    Ok(())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── YAML parsing tests ──

    #[test]
    fn test_parse_valid_frontmatter() {
        let content = "---\nname: my-skill\ndescription: A test skill\n---\n\nBody content here";
        let (fm, body, diags) = parse_skill_md(content, "fallback");

        assert_eq!(fm.name.as_deref(), Some("my-skill"));
        assert_eq!(fm.description.as_deref(), Some("A test skill"));
        assert!(body.contains("Body content here"));
        assert!(diags.is_empty());
    }

    #[test]
    fn test_parse_missing_fields() {
        let content = "---\ncompatibility: v2\n---\n\nBody";
        let (fm, body, diags) = parse_skill_md(content, "dir-name");

        // name and description are None in frontmatter
        assert!(fm.name.is_none());
        assert!(fm.description.is_none());
        assert_eq!(fm.compatibility.as_deref(), Some("v2"));
        assert!(body.contains("Body"));
        assert!(diags.is_empty());
    }

    #[test]
    fn test_parse_malformed_yaml() {
        let content = "---\n: invalid yaml [[\n---\n\nBody";
        let (_fm, body, diags) = parse_skill_md(content, "fallback-dir");

        assert!(!diags.is_empty());
        assert!(diags[0].contains("YAML 파싱 실패"));
        assert!(body.contains("Body"));
    }

    #[test]
    fn test_parse_no_frontmatter() {
        let content = "Just plain text without any frontmatter";
        let (fm, body, diags) = parse_skill_md(content, "my-dir");

        assert_eq!(fm.name.as_deref(), Some("my-dir"));
        assert_eq!(fm.description.as_deref(), Some("(설명 없음)"));
        assert!(body.contains("Just plain text"));
        assert!(!diags.is_empty());
        assert!(diags[0].contains("프론트매터를 찾을 수 없습니다"));
    }

    // ── Lenient loading tests ──

    #[test]
    fn test_name_normalized_to_lowercase() {
        let content = "---\nname: My-SKILL\ndescription: Test\n---\n\nBody";
        let (fm, _body, diags) = parse_skill_md(content, "fallback");
        let metadata = build_metadata(&fm, "fallback", "agent", "/path", diags);

        assert_eq!(metadata.name, "my-skill");
        assert!(
            metadata.diagnostics.iter().any(|d| d.contains("정규화")),
            "should have normalization diagnostic"
        );
    }

    #[test]
    fn test_missing_description_fallback() {
        let content = "---\nname: test\n---\n\nBody";
        let (fm, _body, diags) = parse_skill_md(content, "fallback");
        let metadata = build_metadata(&fm, "fallback", "agent", "/path", diags);

        assert_eq!(metadata.description, "(설명 없음)");
        assert!(metadata.diagnostics.iter().any(|d| d.contains("설명 필드")));
    }

    #[test]
    fn test_missing_name_uses_dir_name() {
        let content = "---\ndescription: A skill\n---\n\nBody";
        let (fm, _body, diags) = parse_skill_md(content, "my-dir-name");
        let metadata = build_metadata(&fm, "my-dir-name", "agent", "/path", diags);

        assert_eq!(metadata.name, "my-dir-name");
        assert!(metadata.diagnostics.iter().any(|d| d.contains("디렉토리 이름")));
    }

    // ── Skill name validation tests ──

    #[test]
    fn test_valid_skill_names() {
        assert!(validate_skill_name("my-skill").is_ok());
        assert!(validate_skill_name("skill123").is_ok());
        assert!(validate_skill_name("a").is_ok());
        assert!(validate_skill_name("web-search-v2").is_ok());
    }

    #[test]
    fn test_invalid_skill_name_uppercase() {
        assert!(validate_skill_name("MySkill").is_err());
    }

    #[test]
    fn test_invalid_skill_name_special_chars() {
        assert!(validate_skill_name("my_skill").is_err());
        assert!(validate_skill_name("my skill").is_err());
        assert!(validate_skill_name("skill.md").is_err());
    }

    #[test]
    fn test_invalid_skill_name_empty() {
        assert!(validate_skill_name("").is_err());
    }

    #[test]
    fn test_invalid_skill_name_too_long() {
        let name = "a".repeat(65);
        assert!(validate_skill_name(&name).is_err());
    }

    #[test]
    fn test_valid_skill_name_max_length() {
        let name = "a".repeat(64);
        assert!(validate_skill_name(&name).is_ok());
    }

    // ── Directory scanning tests ──

    #[test]
    fn test_scan_skills_dir_finds_skills() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");

        // Create two skills
        let s1 = skills_dir.join("skill-one");
        fs::create_dir_all(&s1).unwrap();
        fs::write(
            s1.join("SKILL.md"),
            "---\nname: skill-one\ndescription: First\n---\n\nBody1",
        )
        .unwrap();

        let s2 = skills_dir.join("skill-two");
        fs::create_dir_all(&s2).unwrap();
        fs::write(
            s2.join("SKILL.md"),
            "---\nname: skill-two\ndescription: Second\n---\n\nBody2",
        )
        .unwrap();

        let mut result = HashMap::new();
        scan_skills_dir(&skills_dir, "agent", &mut result).unwrap();

        assert_eq!(result.len(), 2);
        assert!(result.contains_key("skill-one"));
        assert!(result.contains_key("skill-two"));
        assert_eq!(result["skill-one"].source, "agent");
    }

    #[test]
    fn test_scan_skills_dir_skips_non_dirs() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        fs::create_dir_all(&skills_dir).unwrap();

        // Create a file (not a directory)
        fs::write(skills_dir.join("not-a-skill.txt"), "text").unwrap();

        let mut result = HashMap::new();
        scan_skills_dir(&skills_dir, "agent", &mut result).unwrap();

        assert!(result.is_empty());
    }

    #[test]
    fn test_scan_skills_dir_skips_without_skill_md() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");

        // Create a dir without SKILL.md
        let s1 = skills_dir.join("empty-skill");
        fs::create_dir_all(&s1).unwrap();

        let mut result = HashMap::new();
        scan_skills_dir(&skills_dir, "agent", &mut result).unwrap();

        assert!(result.is_empty());
    }

    #[test]
    fn test_agent_overrides_global() {
        let tmp = TempDir::new().unwrap();
        let global_dir = tmp.path().join("global");
        let agent_dir = tmp.path().join("agent");

        // Same skill name in both
        let g = global_dir.join("shared");
        fs::create_dir_all(&g).unwrap();
        fs::write(
            g.join("SKILL.md"),
            "---\nname: shared\ndescription: Global version\n---\n\nGlobal body",
        )
        .unwrap();

        let a = agent_dir.join("shared");
        fs::create_dir_all(&a).unwrap();
        fs::write(
            a.join("SKILL.md"),
            "---\nname: shared\ndescription: Agent version\n---\n\nAgent body",
        )
        .unwrap();

        let mut result = HashMap::new();
        scan_skills_dir(&global_dir, "global", &mut result).unwrap();
        scan_skills_dir(&agent_dir, "agent", &mut result).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result["shared"].source, "agent");
        assert_eq!(result["shared"].description, "Agent version");
    }

    // ── Path validation tests ──

    #[test]
    fn test_path_traversal_blocked() {
        let tmp = TempDir::new().unwrap();
        let evil = tmp.path().join("skills").join("..").join("..").join("etc").join("passwd");
        let result = validate_path_within(&evil, tmp.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_valid_path_passes() {
        let tmp = TempDir::new().unwrap();
        let valid = tmp.path().join("test.txt");
        fs::write(&valid, "ok").unwrap();
        let result = validate_path_within(&valid, tmp.path());
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_name_blocks_traversal() {
        assert!(validate_name("../etc").is_err());
        assert!(validate_name("foo/bar").is_err());
        assert!(validate_name(".hidden").is_err());
        assert!(validate_name("").is_err());
        assert!(validate_name("valid-name").is_ok());
    }

    // ── Resource enumeration tests ──

    #[test]
    fn test_enumerate_resource_files() {
        let tmp = TempDir::new().unwrap();
        let skill = tmp.path().join("my-skill");
        fs::create_dir_all(skill.join("scripts")).unwrap();
        fs::create_dir_all(skill.join("references")).unwrap();
        fs::create_dir_all(skill.join("assets")).unwrap();

        fs::write(skill.join("scripts").join("run.sh"), "#!/bin/bash").unwrap();
        fs::write(skill.join("references").join("doc.md"), "# Doc").unwrap();
        fs::write(skill.join("assets").join("icon.png"), "PNG").unwrap();

        let resources = enumerate_resource_files(&skill);
        assert_eq!(resources.len(), 3);
        assert!(resources.contains(&"scripts/run.sh".to_string()));
        assert!(resources.contains(&"references/doc.md".to_string()));
        assert!(resources.contains(&"assets/icon.png".to_string()));
    }

    #[test]
    fn test_enumerate_resource_files_empty() {
        let tmp = TempDir::new().unwrap();
        let skill = tmp.path().join("empty-skill");
        fs::create_dir_all(&skill).unwrap();

        let resources = enumerate_resource_files(&skill);
        assert!(resources.is_empty());
    }

    // ── CRUD template tests ──

    #[test]
    fn test_create_template_is_parseable() {
        let skill_name = "test-skill";
        let template = format!(
            "---\nname: {}\ndescription: 새 특기에 대한 설명을 입력하세요.\n---\n\n# {}\n\n여기에 에이전트가 따를 지침을 작성하세요.\n",
            skill_name, skill_name
        );

        let (fm, body, diags) = parse_skill_md(&template, skill_name);
        assert!(diags.is_empty());
        assert_eq!(fm.name.as_deref(), Some("test-skill"));
        assert!(fm.description.is_some());
        assert!(body.contains("# test-skill"));
    }

    #[test]
    fn test_update_content_roundtrip() {
        let content = "---\nname: updated\ndescription: Updated description\nlicense: MIT\n---\n\n# Updated body\n\nNew instructions here.\n";
        let (fm, body, diags) = parse_skill_md(content, "updated");
        let metadata = build_metadata(&fm, "updated", "agent", "/path", diags);

        assert_eq!(metadata.name, "updated");
        assert_eq!(metadata.description, "Updated description");
        assert_eq!(metadata.license.as_deref(), Some("MIT"));
        assert!(body.contains("New instructions"));
        assert!(metadata.diagnostics.is_empty());
    }

    #[test]
    fn test_delete_directory_cleanup() {
        let tmp = TempDir::new().unwrap();
        let skill_dir = tmp.path().join("to-delete");
        fs::create_dir_all(skill_dir.join("scripts")).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "---\nname: x\n---\n").unwrap();
        fs::write(skill_dir.join("scripts").join("run.sh"), "echo hi").unwrap();

        assert!(skill_dir.exists());
        fs::remove_dir_all(&skill_dir).unwrap();
        assert!(!skill_dir.exists());
    }

    // ── Extra metadata tests ──

    #[test]
    fn test_extra_fields_in_metadata_map() {
        let content = "---\nname: test\ndescription: desc\nauthor: someone\nversion: 1.0\n---\n\nBody";
        let (fm, _body, diags) = parse_skill_md(content, "test");
        let metadata = build_metadata(&fm, "test", "agent", "/path", diags);

        let map = metadata.metadata_map.expect("should have extra fields");
        assert_eq!(map.get("author").map(|s| s.as_str()), Some("someone"));
        assert_eq!(map.get("version").map(|s| s.as_str()), Some("1.0"));
    }

    #[test]
    fn test_compatibility_and_license_fields() {
        let content = "---\nname: test\ndescription: desc\ncompatibility: v2\nlicense: Apache-2.0\n---\n\nBody";
        let (fm, _body, diags) = parse_skill_md(content, "test");
        let metadata = build_metadata(&fm, "test", "agent", "/path", diags);

        assert_eq!(metadata.compatibility.as_deref(), Some("v2"));
        assert_eq!(metadata.license.as_deref(), Some("Apache-2.0"));
    }
}
