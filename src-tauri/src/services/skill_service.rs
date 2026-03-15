use crate::error::AppError;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

// ── YAML frontmatter types (internal) ──

#[derive(Debug, Deserialize, Default)]
pub struct SkillFrontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub compatibility: Option<String>,
    pub license: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

/// Result of parsing a SKILL.md file.
pub struct ParseResult {
    pub frontmatter: SkillFrontmatter,
    pub body: String,
    pub diagnostics: Vec<String>,
}

/// Parsed skill metadata (before building the full SkillMetadata).
pub struct BuiltMetadata {
    pub name: String,
    pub description: String,
    pub compatibility: Option<String>,
    pub license: Option<String>,
    pub metadata_map: Option<HashMap<String, String>>,
    pub diagnostics: Vec<String>,
}

// ── Frontmatter parsing ──

/// Parse SKILL.md content into frontmatter + body.
pub fn parse_frontmatter(content: &str, dir_name: &str) -> ParseResult {
    let mut diagnostics = Vec::new();

    // Try to split on --- delimiters
    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() >= 3 && parts[0].trim().is_empty() {
        // Valid frontmatter structure: empty --- yaml --- body
        let yaml_str = parts[1];
        let body = parts[2].to_string();

        match serde_yaml::from_str::<SkillFrontmatter>(yaml_str) {
            Ok(fm) => ParseResult { frontmatter: fm, body, diagnostics },
            Err(e) => {
                diagnostics.push(format!("YAML 파싱 실패: {}", e));
                let fallback = SkillFrontmatter {
                    name: Some(dir_name.to_string()),
                    description: Some("(설명 없음)".to_string()),
                    ..Default::default()
                };
                ParseResult { frontmatter: fallback, body, diagnostics }
            }
        }
    } else {
        diagnostics.push("프론트매터를 찾을 수 없습니다".to_string());
        let fallback = SkillFrontmatter {
            name: Some(dir_name.to_string()),
            description: Some("(설명 없음)".to_string()),
            ..Default::default()
        };
        ParseResult { frontmatter: fallback, body: content.to_string(), diagnostics }
    }
}

/// Build metadata fields from parsed frontmatter.
pub fn build_metadata(
    fm: &SkillFrontmatter,
    dir_name: &str,
    mut diagnostics: Vec<String>,
) -> BuiltMetadata {
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

    BuiltMetadata {
        name: normalized,
        description,
        compatibility: fm.compatibility.clone(),
        license: fm.license.clone(),
        metadata_map,
        diagnostics,
    }
}

// ── Directory scanning ──

/// Enumerate resource files from scripts/, references/, assets/ subdirs.
pub fn enumerate_resource_files(skill_dir: &Path) -> Vec<String> {
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

/// Validate a skill name: lowercase alphanumeric + hyphens, 1-64 chars.
pub fn validate_skill_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::Validation(format!(
            "Skill name must be 1-64 characters, got {}",
            name.len()
        )));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(AppError::Validation(format!(
            "Skill name must contain only lowercase alphanumeric characters and hyphens: {}",
            name
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── parse_frontmatter ──

    #[test]
    fn test_parse_valid() {
        let content = "---\nname: my-skill\ndescription: A test skill\n---\n\nBody content here";
        let result = parse_frontmatter(content, "fallback");
        assert_eq!(result.frontmatter.name.as_deref(), Some("my-skill"));
        assert_eq!(result.frontmatter.description.as_deref(), Some("A test skill"));
        assert!(result.body.contains("Body content here"));
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn test_parse_malformed_yaml() {
        let content = "---\n: invalid yaml [[\n---\n\nBody";
        let result = parse_frontmatter(content, "fallback-dir");
        assert!(!result.diagnostics.is_empty());
        assert!(result.diagnostics[0].contains("YAML 파싱 실패"));
    }

    #[test]
    fn test_parse_no_frontmatter() {
        let content = "Just plain text without any frontmatter";
        let result = parse_frontmatter(content, "my-dir");
        assert_eq!(result.frontmatter.name.as_deref(), Some("my-dir"));
        assert!(!result.diagnostics.is_empty());
        assert!(result.diagnostics[0].contains("프론트매터를 찾을 수 없습니다"));
    }

    // ── build_metadata ──

    #[test]
    fn test_build_normalizes_name() {
        let content = "---\nname: My-SKILL\ndescription: Test\n---\n\nBody";
        let parsed = parse_frontmatter(content, "fallback");
        let meta = build_metadata(&parsed.frontmatter, "fallback", parsed.diagnostics);
        assert_eq!(meta.name, "my-skill");
        assert!(meta.diagnostics.iter().any(|d| d.contains("정규화")));
    }

    #[test]
    fn test_build_missing_name_uses_dir() {
        let content = "---\ndescription: A skill\n---\n\nBody";
        let parsed = parse_frontmatter(content, "my-dir-name");
        let meta = build_metadata(&parsed.frontmatter, "my-dir-name", parsed.diagnostics);
        assert_eq!(meta.name, "my-dir-name");
        assert!(meta.diagnostics.iter().any(|d| d.contains("디렉토리 이름")));
    }

    // ── enumerate_resource_files ──

    #[test]
    fn test_enumerate_files() {
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
    }

    #[test]
    fn test_enumerate_empty() {
        let tmp = TempDir::new().unwrap();
        let skill = tmp.path().join("empty-skill");
        fs::create_dir_all(&skill).unwrap();
        let resources = enumerate_resource_files(&skill);
        assert!(resources.is_empty());
    }

    // ── validate_skill_name ──

    #[test]
    fn test_valid_names() {
        assert!(validate_skill_name("my-skill").is_ok());
        assert!(validate_skill_name("skill123").is_ok());
        assert!(validate_skill_name("a").is_ok());
    }

    #[test]
    fn test_invalid_names() {
        assert!(validate_skill_name("").is_err());
        assert!(validate_skill_name("MySkill").is_err());
        assert!(validate_skill_name("my_skill").is_err());
        assert!(validate_skill_name(&"a".repeat(65)).is_err());
    }
}
