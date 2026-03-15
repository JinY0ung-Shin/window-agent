use serde_json::json;
use std::path::Path;

/// The 13 native tools built into the runtime, with their default tiers.
/// Must stay in sync with `native_tool_definitions()` in tool_commands.rs.
/// Must stay in sync with `native_tool_definitions()` in tool_commands.rs.
const NATIVE_TOOLS: &[(&str, &str)] = &[
    ("read_file", "auto"),
    ("write_file", "confirm"),
    ("list_directory", "auto"),
    ("web_search", "confirm"),
    ("memory_note", "auto"),
    ("browser_navigate", "confirm"),
    ("browser_snapshot", "auto"),
    ("browser_click", "confirm"),
    ("browser_type", "confirm"),
    ("browser_wait", "auto"),
    ("browser_back", "confirm"),
    ("browser_close", "confirm"),
    ("http_request", "confirm"),
];

/// Just the names, for iteration.
const NATIVE_TOOL_NAMES: &[&str] = &[
    "read_file",
    "write_file",
    "list_directory",
    "web_search",
    "memory_note",
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_wait",
    "browser_back",
    "browser_close",
    "http_request",
];

/// Per-agent idempotent migration from TOOLS.md → TOOL_CONFIG.json.
///
/// - If TOOL_CONFIG.json already exists → skip (idempotent).
/// - If TOOLS.md exists and is non-empty → parse it, generate TOOL_CONFIG.json,
///   and rename TOOLS.md → TOOLS_LEGACY.md when it contains non-native entries.
/// - If neither exists → do nothing (agent has 0 tools).
pub fn ensure_tool_config(agent_dir: &Path) -> Result<(), String> {
    let config_path = agent_dir.join("TOOL_CONFIG.json");
    if config_path.exists() {
        return Ok(()); // already migrated
    }

    let tools_md_path = agent_dir.join("TOOLS.md");
    if !tools_md_path.exists() {
        return Ok(()); // no tools to migrate
    }

    let content = std::fs::read_to_string(&tools_md_path)
        .map_err(|e| format!("Failed to read TOOLS.md: {}", e))?;

    if content.trim().is_empty() {
        return Ok(()); // empty file, nothing to migrate
    }

    let config = parse_tools_md_to_config(&content);

    let config_str = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize TOOL_CONFIG.json: {}", e))?;

    std::fs::write(&config_path, config_str)
        .map_err(|e| format!("Failed to write TOOL_CONFIG.json: {}", e))?;

    // If TOOLS.md contains non-native entries, preserve as TOOLS_LEGACY.md
    if has_non_native_entries(&content) {
        let legacy_path = agent_dir.join("TOOLS_LEGACY.md");
        std::fs::rename(&tools_md_path, &legacy_path)
            .map_err(|e| format!("Failed to rename TOOLS.md to TOOLS_LEGACY.md: {}", e))?;
    }

    Ok(())
}

/// Parse TOOLS.md markdown and produce a TOOL_CONFIG.json value.
///
/// Expected TOOLS.md format:
/// ```text
/// ## tool_name
/// - description: ...
/// - tier: auto | confirm | deny
/// - parameters:
///   - param (type, required): desc
/// ```
///
/// For native tools found in TOOLS.md: `enabled: true`, tier from the file.
/// For native tools NOT in TOOLS.md: `enabled: false` (they weren't being used).
fn parse_tools_md_to_config(content: &str) -> serde_json::Value {
    // Collect (tool_name, tier) pairs from TOOLS.md
    let mut found_tools: Vec<(String, String)> = Vec::new();
    let mut current_tool: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        if let Some(heading) = trimmed.strip_prefix("## ") {
            // Save previous tool if it had no tier line
            if let Some(ref prev_name) = current_tool {
                if !found_tools.iter().any(|(n, _)| n == prev_name) {
                    found_tools.push((prev_name.clone(), "confirm".to_string()));
                }
            }
            let name = heading.trim().to_string();
            current_tool = Some(name);
        } else if trimmed.starts_with("- tier:") {
            if let Some(ref tool_name) = current_tool {
                let tier = trimmed
                    .trim_start_matches("- tier:")
                    .trim()
                    .to_string();
                found_tools.push((tool_name.clone(), tier));
            }
        }
    }
    // Save last tool if it had no tier line
    if let Some(ref last_name) = current_tool {
        if !found_tools.iter().any(|(n, _)| n == last_name) {
            found_tools.push((last_name.clone(), "confirm".to_string()));
        }
    }

    let found_map: std::collections::HashMap<String, String> =
        found_tools.into_iter().collect();

    // Build native section: only native tools go into config
    let mut native = serde_json::Map::new();
    for &(name, default_tier) in NATIVE_TOOLS {
        let (enabled, tier) = if let Some(t) = found_map.get(name) {
            (true, t.as_str())
        } else {
            (false, default_tier)
        };
        native.insert(
            name.to_string(),
            json!({ "enabled": enabled, "tier": tier }),
        );
    }

    json!({
        "version": 1,
        "native": native,
    })
}

/// Returns true if TOOLS.md contains any tool names that are NOT in NATIVE_TOOL_NAMES.
fn has_non_native_entries(content: &str) -> bool {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("## ") {
            let name = heading.trim();
            if !NATIVE_TOOL_NAMES.contains(&name) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_idempotency() {
        let tmp = TempDir::new().unwrap();
        let config_path = tmp.path().join("TOOL_CONFIG.json");
        fs::write(&config_path, r#"{"version":1,"native":{}}"#).unwrap();

        // Should succeed and not overwrite
        assert!(ensure_tool_config(tmp.path()).is_ok());
        let content = fs::read_to_string(&config_path).unwrap();
        assert_eq!(content, r#"{"version":1,"native":{}}"#);
    }

    #[test]
    fn test_native_only_migration() {
        let tmp = TempDir::new().unwrap();
        let tools_md = tmp.path().join("TOOLS.md");
        fs::write(
            &tools_md,
            "## read_file\n- description: Read a file\n- tier: auto\n\n## write_file\n- description: Write\n- tier: confirm\n",
        )
        .unwrap();

        assert!(ensure_tool_config(tmp.path()).is_ok());

        // TOOL_CONFIG.json should exist
        let config_path = tmp.path().join("TOOL_CONFIG.json");
        assert!(config_path.exists());

        let config: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(config["version"], 1);
        assert_eq!(config["native"]["read_file"]["enabled"], true);
        assert_eq!(config["native"]["read_file"]["tier"], "auto");
        assert_eq!(config["native"]["write_file"]["enabled"], true);
        assert_eq!(config["native"]["write_file"]["tier"], "confirm");
        // Tools not in TOOLS.md should be disabled
        assert_eq!(config["native"]["browser_close"]["enabled"], false);

        // TOOLS.md should NOT be renamed (all native)
        assert!(tools_md.exists());
        assert!(!tmp.path().join("TOOLS_LEGACY.md").exists());
    }

    #[test]
    fn test_non_native_legacy_preservation() {
        let tmp = TempDir::new().unwrap();
        let tools_md = tmp.path().join("TOOLS.md");
        fs::write(
            &tools_md,
            "## read_file\n- tier: auto\n\n## custom_plugin\n- tier: confirm\n",
        )
        .unwrap();

        assert!(ensure_tool_config(tmp.path()).is_ok());

        // TOOL_CONFIG.json should exist with native tools only
        let config_path = tmp.path().join("TOOL_CONFIG.json");
        assert!(config_path.exists());

        let config: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(config["native"]["read_file"]["enabled"], true);
        // custom_plugin is non-native, should NOT appear in native section
        assert!(config["native"].get("custom_plugin").is_none());

        // TOOLS.md should be renamed to TOOLS_LEGACY.md
        assert!(!tools_md.exists());
        assert!(tmp.path().join("TOOLS_LEGACY.md").exists());
    }

    #[test]
    fn test_empty_tools_md() {
        let tmp = TempDir::new().unwrap();
        let tools_md = tmp.path().join("TOOLS.md");
        fs::write(&tools_md, "   \n  ").unwrap();

        assert!(ensure_tool_config(tmp.path()).is_ok());

        // Should not create TOOL_CONFIG.json for empty content
        assert!(!tmp.path().join("TOOL_CONFIG.json").exists());
    }

    #[test]
    fn test_missing_files() {
        let tmp = TempDir::new().unwrap();
        // Neither TOOLS.md nor TOOL_CONFIG.json exists
        assert!(ensure_tool_config(tmp.path()).is_ok());
        assert!(!tmp.path().join("TOOL_CONFIG.json").exists());
    }

    #[test]
    fn test_has_non_native_entries() {
        assert!(!has_non_native_entries("## read_file\n- tier: auto\n"));
        assert!(has_non_native_entries("## read_file\n- tier: auto\n\n## my_custom_tool\n- tier: confirm\n"));
        assert!(!has_non_native_entries(""));
    }

    #[test]
    fn test_parse_all_native_tools() {
        // Verify all 13 native tools appear in output even if not in input
        let config = parse_tools_md_to_config("## read_file\n- tier: auto\n");
        let native = config["native"].as_object().unwrap();
        assert_eq!(native.len(), 13);
        for &name in NATIVE_TOOL_NAMES {
            assert!(native.contains_key(name), "missing native tool: {}", name);
        }
    }
}
