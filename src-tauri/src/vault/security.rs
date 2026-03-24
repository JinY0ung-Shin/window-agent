use std::path::{Component, Path, PathBuf};

/// Vault-specific security policy for path validation and access control.
pub struct VaultSecurity {
    pub vault_root: PathBuf,
}

impl VaultSecurity {
    pub fn new(vault_root: PathBuf) -> Self {
        Self { vault_root }
    }

    /// Validate that a path is within the vault root.
    ///
    /// For existing files: canonicalize the full path.
    /// For new files: canonicalize the parent directory, then join the filename.
    pub fn validate_within_vault(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = if path.exists() {
            std::fs::canonicalize(path)
                .map_err(|e| format!("Cannot resolve path '{}': {e}", path.display()))?
        } else {
            let parent = path
                .parent()
                .ok_or_else(|| format!("Invalid path: {}", path.display()))?;

            if parent.exists() {
                let canonical_parent = std::fs::canonicalize(parent)
                    .map_err(|e| format!("Cannot resolve parent of '{}': {e}", path.display()))?;
                let file_name = path
                    .file_name()
                    .ok_or_else(|| format!("Invalid file name in path: {}", path.display()))?;
                canonical_parent.join(file_name)
            } else {
                // Parent doesn't exist yet — do component-level check
                self.validate_components(path)?
            }
        };

        let canonical_root = if self.vault_root.exists() {
            std::fs::canonicalize(&self.vault_root)
                .unwrap_or_else(|_| self.vault_root.clone())
        } else {
            self.vault_root.clone()
        };

        if canonical.starts_with(&canonical_root) {
            Ok(canonical)
        } else {
            Err(format!(
                "Path '{}' is outside vault directory",
                path.display()
            ))
        }
    }

    /// Fallback validation by checking path components for traversal.
    fn validate_components(&self, path: &Path) -> Result<PathBuf, String> {
        for component in path.components() {
            if let Component::ParentDir = component {
                return Err(format!(
                    "Path traversal detected in: {}",
                    path.display()
                ));
            }
        }
        if path.starts_with(&self.vault_root) {
            Ok(path.to_path_buf())
        } else {
            Err(format!(
                "Path '{}' is outside vault directory",
                path.display()
            ))
        }
    }

    /// Sanitize a filename, rejecting dangerous characters.
    ///
    /// Forbidden: `/`, `\`, `..`, control characters, null bytes, `.` prefix.
    /// Max length: 200 characters.
    pub fn sanitize_filename(name: &str) -> Result<String, String> {
        if name.is_empty() {
            return Err("Filename cannot be empty".to_string());
        }
        if name.contains('/') || name.contains('\\') {
            return Err(format!("Filename contains path separator: {name}"));
        }
        if name.contains("..") {
            return Err(format!("Filename contains path traversal: {name}"));
        }
        if name.starts_with('.') {
            return Err(format!("Filename starts with dot: {name}"));
        }
        if name.contains('\0') {
            return Err("Filename contains null byte".to_string());
        }
        for ch in name.chars() {
            if ch.is_control() {
                return Err(format!("Filename contains control character: {name}"));
            }
        }
        if name.chars().count() > 200 {
            return Err(format!(
                "Filename too long ({} chars, max 200)",
                name.chars().count()
            ));
        }
        Ok(name.to_string())
    }

    /// Validate agent access: an agent may only access its own folder, shared/, and templates/.
    ///
    /// `agent_folder` is the agent's folder name (e.g., "manager").
    /// `path` is the target path within the vault.
    pub fn validate_agent_access(&self, agent_folder: &str, path: &Path) -> Result<(), String> {
        // First ensure the path is within the vault
        let validated = self.validate_within_vault(path)?;

        let canonical_root = if self.vault_root.exists() {
            std::fs::canonicalize(&self.vault_root)
                .unwrap_or_else(|_| self.vault_root.clone())
        } else {
            self.vault_root.clone()
        };

        let relative = validated
            .strip_prefix(&canonical_root)
            .map_err(|_| "Path is not within vault".to_string())?;

        let first_component = relative
            .components()
            .next()
            .and_then(|c| match c {
                Component::Normal(s) => s.to_str(),
                _ => None,
            });

        match first_component {
            Some("shared") | Some("templates") => Ok(()),
            Some("agents") => {
                // Must be under agents/<agent_folder>/
                let second_component = relative
                    .components()
                    .nth(1)
                    .and_then(|c| match c {
                        Component::Normal(s) => s.to_str(),
                        _ => None,
                    });
                match second_component {
                    Some(folder) if folder == agent_folder => Ok(()),
                    Some(folder) => Err(format!(
                        "Agent '{agent_folder}' cannot access folder of agent '{folder}'"
                    )),
                    None => Err("Invalid path within agents/".to_string()),
                }
            }
            Some(other) => Err(format!("Access denied to vault path: {other}")),
            None => Err("Empty relative path".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_vault() -> (TempDir, VaultSecurity) {
        let tmp = TempDir::new().unwrap();
        let vault_root = tmp.path().to_path_buf();
        fs::create_dir_all(vault_root.join("agents/manager")).unwrap();
        fs::create_dir_all(vault_root.join("agents/researcher")).unwrap();
        fs::create_dir_all(vault_root.join("shared/project")).unwrap();
        fs::create_dir_all(vault_root.join("templates")).unwrap();
        let security = VaultSecurity::new(vault_root);
        (tmp, security)
    }

    #[test]
    fn test_validate_within_vault_ok() {
        let (tmp, sec) = setup_vault();
        let file = tmp.path().join("agents/manager/test.md");
        fs::write(&file, "test").unwrap();
        assert!(sec.validate_within_vault(&file).is_ok());
    }

    #[test]
    fn test_validate_within_vault_outside() {
        let (_tmp, sec) = setup_vault();
        let outside = PathBuf::from("/etc/passwd");
        assert!(sec.validate_within_vault(&outside).is_err());
    }

    #[test]
    fn test_validate_within_vault_traversal() {
        let (tmp, sec) = setup_vault();
        let evil = tmp.path().join("agents/../../etc/passwd");
        assert!(sec.validate_within_vault(&evil).is_err());
    }

    #[test]
    fn test_sanitize_filename_ok() {
        assert!(VaultSecurity::sanitize_filename("valid-name.md").is_ok());
        assert!(VaultSecurity::sanitize_filename("한글노트.md").is_ok());
    }

    #[test]
    fn test_sanitize_filename_rejects() {
        assert!(VaultSecurity::sanitize_filename("").is_err());
        assert!(VaultSecurity::sanitize_filename("../evil").is_err());
        assert!(VaultSecurity::sanitize_filename(".hidden").is_err());
        assert!(VaultSecurity::sanitize_filename("a/b").is_err());
        assert!(VaultSecurity::sanitize_filename("a\\b").is_err());
        assert!(VaultSecurity::sanitize_filename("a\0b").is_err());
    }

    #[test]
    fn test_sanitize_filename_too_long() {
        let long_name = "a".repeat(201);
        assert!(VaultSecurity::sanitize_filename(&long_name).is_err());
    }

    #[test]
    fn test_agent_access_own_folder() {
        let (tmp, sec) = setup_vault();
        let path = tmp.path().join("agents/manager/note.md");
        fs::write(&path, "test").unwrap();
        assert!(sec.validate_agent_access("manager", &path).is_ok());
    }

    #[test]
    fn test_agent_access_shared() {
        let (tmp, sec) = setup_vault();
        let path = tmp.path().join("shared/project/note.md");
        fs::write(&path, "test").unwrap();
        assert!(sec.validate_agent_access("manager", &path).is_ok());
    }

    #[test]
    fn test_agent_access_templates() {
        let (tmp, sec) = setup_vault();
        let path = tmp.path().join("templates/knowledge.md");
        fs::write(&path, "test").unwrap();
        assert!(sec.validate_agent_access("manager", &path).is_ok());
    }

    #[test]
    fn test_agent_access_other_agent_denied() {
        let (tmp, sec) = setup_vault();
        let path = tmp.path().join("agents/researcher/note.md");
        fs::write(&path, "test").unwrap();
        assert!(sec.validate_agent_access("manager", &path).is_err());
    }

    // ── validate_within_vault new file (parent exists) ──

    #[test]
    fn test_validate_within_vault_new_file_parent_exists() {
        let (tmp, sec) = setup_vault();
        // File doesn't exist but parent does
        let new_file = tmp.path().join("agents/manager/new-note.md");
        let result = sec.validate_within_vault(&new_file);
        assert!(result.is_ok());
    }

    // ── validate_within_vault new file (parent doesn't exist, component check) ──

    #[test]
    fn test_validate_within_vault_new_file_parent_not_exists_valid() {
        let (tmp, sec) = setup_vault();
        // Neither parent nor file exists — falls back to component check
        let deep = tmp.path().join("agents/manager/subdir/note.md");
        let result = sec.validate_within_vault(&deep);
        // Should succeed since path starts with vault root and no traversal
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_within_vault_component_check_traversal_rejected() {
        let (tmp, sec) = setup_vault();
        // Parent doesn't exist AND has traversal
        let evil = tmp.path().join("agents/manager/../../outside/note.md");
        // The component check should catch ".." even when parent doesn't exist
        let result = sec.validate_within_vault(&evil);
        assert!(result.is_err());
    }

    // ── sanitize_filename control character ──

    #[test]
    fn test_sanitize_filename_control_char() {
        let result = VaultSecurity::sanitize_filename("name\x07bell.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("control character"));
    }

    // ── sanitize_filename exact boundary ──

    #[test]
    fn test_sanitize_filename_exact_200_chars_ok() {
        let name = "a".repeat(200);
        assert!(VaultSecurity::sanitize_filename(&name).is_ok());
    }

    // ── agent access: denied outside vault ──

    #[test]
    fn test_agent_access_outside_vault_denied() {
        let (_tmp, sec) = setup_vault();
        let outside = PathBuf::from("/tmp/evil-file.md");
        // Even for a valid agent, access outside vault is denied
        let result = sec.validate_agent_access("manager", &outside);
        assert!(result.is_err());
    }

    // ── agent access: invalid path within agents/ ──

    #[test]
    fn test_agent_access_agents_root_denied() {
        let (tmp, sec) = setup_vault();
        // File directly in agents/ (not under any agent folder)
        let path = tmp.path().join("agents/some-file.md");
        fs::write(&path, "test").unwrap();
        let result = sec.validate_agent_access("manager", &path);
        assert!(result.is_err());
    }

    // ── agent access: unknown top-level path ──

    #[test]
    fn test_agent_access_unknown_top_level_denied() {
        let (tmp, sec) = setup_vault();
        let unknown_dir = tmp.path().join("unknown");
        fs::create_dir_all(&unknown_dir).unwrap();
        let path = unknown_dir.join("file.md");
        fs::write(&path, "test").unwrap();
        let result = sec.validate_agent_access("manager", &path);
        assert!(result.is_err());
    }
}
