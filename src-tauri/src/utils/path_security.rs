use std::path::{Component, Path, PathBuf};

/// Allowed persona file names for agent directories.
pub const ALLOWED_AGENT_FILES: &[&str] = &["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md"];

// ── Common internal helpers ──

/// Canonicalize a root path, falling back to the raw path on failure.
fn canonicalize_root(root: &Path) -> PathBuf {
    if root.exists() {
        std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
    } else {
        root.to_path_buf()
    }
}

// ── Public API ──

/// Reject names containing path traversal characters.
/// Checks: empty, '/', '\\', '..', leading '.'.
/// Extracted from skill_commands::validate_name and agent_commands::validate_folder_name.
pub fn validate_no_traversal(name: &str, label: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err(format!("Invalid {}: {}", label, name));
    }
    Ok(())
}

/// Validate that a resolved path is within an allowed root.
/// For existing paths, canonicalizes fully. For non-existing paths, canonicalizes parent.
/// Falls back to component-level check if the parent doesn't exist either.
///
/// 1:1 replacement for skill_commands::validate_path_within + validate_path_components.
pub fn validate_skill_path(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let canonical = if path.exists() {
        std::fs::canonicalize(path)
            .map_err(|e| format!("Cannot resolve path '{}': {}", path.display(), e))?
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

    let canonical_root = canonicalize_root(root);

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
        if let Component::ParentDir = component {
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

/// Validate agent file inputs (file name whitelist + folder traversal check).
/// 1:1 replacement for agent_commands::validate_agent_file_inputs.
pub fn validate_agent_filename(folder_name: &str, file_name: &str) -> Result<(), String> {
    if !ALLOWED_AGENT_FILES.contains(&file_name) {
        return Err(format!("Invalid file name: {file_name}"));
    }
    if folder_name.contains('/') || folder_name.contains('\\') || folder_name.contains("..") {
        return Err(format!("Invalid folder name: {folder_name}"));
    }
    Ok(())
}

/// Resolve and validate a path against multiple allowed roots.
/// Returns the canonicalized path if it falls within any allowed root.
///
/// 1:1 replacement for tool_commands::validate_path.
pub fn validate_tool_roots(raw_path: &str, allowed_roots: &[PathBuf]) -> Result<PathBuf, String> {
    let path = Path::new(raw_path);

    // Resolve to absolute, canonicalizing symlinks
    let canonical = if path.exists() {
        std::fs::canonicalize(path)
            .map_err(|e| format!("Cannot resolve path '{}': {}", raw_path, e))?
    } else {
        // For write targets that don't exist yet, canonicalize the parent
        let parent = path
            .parent()
            .ok_or_else(|| format!("Invalid path: {}", raw_path))?;
        let canonical_parent = std::fs::canonicalize(parent)
            .map_err(|e| format!("Cannot resolve parent of '{}': {}", raw_path, e))?;
        canonical_parent.join(
            path.file_name()
                .ok_or_else(|| format!("Invalid file name in path: {}", raw_path))?,
        )
    };

    for root in allowed_roots {
        let canonical_root = canonicalize_root(root);
        if canonical.starts_with(&canonical_root) {
            return Ok(canonical);
        }
    }

    Err(format!(
        "Path '{}' is outside allowed directories",
        raw_path
    ))
}

/// Validate a ZIP entry path has no path traversal.
/// Rejects absolute paths, backslash paths, and ".." components.
///
/// 1:1 replacement for the inline zip traversal check in export_commands.
pub fn validate_zip_entry(relative_path: &str) -> Result<(), String> {
    if relative_path.contains("..") || relative_path.starts_with('/') || relative_path.starts_with('\\') {
        return Err(format!("Invalid path in ZIP: {}", relative_path));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── validate_no_traversal ──

    #[test]
    fn test_no_traversal_valid() {
        assert!(validate_no_traversal("valid-name", "name").is_ok());
        assert!(validate_no_traversal("에이전트", "name").is_ok());
    }

    #[test]
    fn test_no_traversal_rejects() {
        assert!(validate_no_traversal("", "name").is_err());
        assert!(validate_no_traversal("../etc", "name").is_err());
        assert!(validate_no_traversal("foo/bar", "name").is_err());
        assert!(validate_no_traversal(".hidden", "name").is_err());
        assert!(validate_no_traversal("foo\\bar", "name").is_err());
    }

    // ── validate_skill_path ──

    #[test]
    fn test_skill_path_valid() {
        let tmp = TempDir::new().unwrap();
        let valid = tmp.path().join("test.txt");
        fs::write(&valid, "ok").unwrap();
        let result = validate_skill_path(&valid, tmp.path());
        assert!(result.is_ok());
    }

    #[test]
    fn test_skill_path_traversal_blocked() {
        let tmp = TempDir::new().unwrap();
        let evil = tmp.path().join("skills").join("..").join("..").join("etc").join("passwd");
        let result = validate_skill_path(&evil, tmp.path());
        assert!(result.is_err());
    }

    // ── validate_agent_filename ──

    #[test]
    fn test_agent_filename_valid() {
        assert!(validate_agent_filename("my-agent", "IDENTITY.md").is_ok());
        assert!(validate_agent_filename("my-agent", "SOUL.md").is_ok());
        assert!(validate_agent_filename("my-agent", "TOOLS.md").is_ok());
    }

    #[test]
    fn test_agent_filename_rejects_bad_file() {
        assert!(validate_agent_filename("my-agent", "hack.md").is_err());
        assert!(validate_agent_filename("my-agent", "").is_err());
    }

    #[test]
    fn test_agent_filename_rejects_bad_folder() {
        assert!(validate_agent_filename("../../etc", "IDENTITY.md").is_err());
        assert!(validate_agent_filename("..\\etc", "IDENTITY.md").is_err());
        assert!(validate_agent_filename("..", "IDENTITY.md").is_err());
    }

    // ── validate_tool_roots ──

    #[test]
    fn test_tool_roots_inside() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.txt");
        fs::write(&file_path, "hello").unwrap();
        let allowed = vec![tmp.path().to_path_buf()];
        let result = validate_tool_roots(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_tool_roots_outside() {
        let tmp = TempDir::new().unwrap();
        let allowed = vec![tmp.path().to_path_buf()];
        let result = validate_tool_roots("/etc/passwd", &allowed);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside allowed"));
    }

    #[test]
    fn test_tool_roots_traversal() {
        let tmp = TempDir::new().unwrap();
        let allowed = vec![tmp.path().to_path_buf()];
        let evil = format!("{}/../../../etc/passwd", tmp.path().display());
        let result = validate_tool_roots(&evil, &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_tool_roots_nonexistent_parent_valid() {
        let tmp = TempDir::new().unwrap();
        let allowed = vec![tmp.path().to_path_buf()];
        let new_file = tmp.path().join("newfile.txt");
        let result = validate_tool_roots(new_file.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
    }

    // ── validate_zip_entry ──

    #[test]
    fn test_zip_entry_valid() {
        assert!(validate_zip_entry("skills/my-skill/SKILL.md").is_ok());
        assert!(validate_zip_entry("persona/IDENTITY.md").is_ok());
    }

    #[test]
    fn test_zip_entry_rejects() {
        assert!(validate_zip_entry("../../../etc/passwd").is_err());
        assert!(validate_zip_entry("/absolute/path").is_err());
        assert!(validate_zip_entry("\\windows\\path").is_err());
    }
}
