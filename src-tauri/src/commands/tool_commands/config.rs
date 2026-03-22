use crate::error::AppError;
use crate::utils::path_security::validate_no_traversal;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::schema::native_tool_definitions;

// ── Native tool definitions & config commands ──

/// Returns all native tool definitions with full schemas.
#[tauri::command]
pub fn get_native_tools() -> Result<Vec<super::schema::NativeToolDef>, AppError> {
    Ok(native_tool_definitions())
}

/// Generates default TOOL_CONFIG.json from native tool definitions.
/// Each tool's `default_enabled` field (from schema.rs) is the single source of truth.
/// Orchestration tools are excluded — they are managed by the team orchestrator.
#[tauri::command]
pub fn get_default_tool_config() -> Result<String, AppError> {
    let defs = native_tool_definitions();
    let mut native = serde_json::Map::new();
    for def in defs.iter().filter(|d| d.category != "orchestration") {
        native.insert(
            def.name.clone(),
            serde_json::json!({ "enabled": def.default_enabled, "tier": def.default_tier }),
        );
    }
    let config = serde_json::json!({ "version": 2, "auto_approve": false, "native": native, "credentials": {} });
    serde_json::to_string_pretty(&config).map_err(|e| AppError::Json(e.to_string()))
}

/// Read TOOL_CONFIG.json for an agent, normalizing on the fly.
#[tauri::command]
pub fn read_tool_config(app: AppHandle, folder_name: String) -> Result<String, AppError> {
    validate_no_traversal(&folder_name, "folder name").map_err(AppError::Validation)?;
    let agents_dir = get_agents_dir_for_tools(&app).map_err(AppError::Config)?;
    let config_path = agents_dir.join(&folder_name).join("TOOL_CONFIG.json");
    let raw = std::fs::read_to_string(&config_path)
        .map_err(|e| AppError::Io(format!("Failed to read TOOL_CONFIG.json: {}", e)))?;

    let (normalized, changed) = normalize_tool_config(&raw).map_err(AppError::Json)?;
    if changed {
        // Lazy write-back
        let _ = std::fs::write(&config_path, &normalized);
    }
    Ok(normalized)
}

/// Write TOOL_CONFIG.json for an agent.
#[tauri::command]
pub fn write_tool_config(
    app: AppHandle,
    folder_name: String,
    config: String,
) -> Result<(), AppError> {
    validate_no_traversal(&folder_name, "folder name").map_err(AppError::Validation)?;

    // Validate that the config is valid JSON
    serde_json::from_str::<serde_json::Value>(&config)
        .map_err(|e| AppError::Json(format!("Invalid JSON: {}", e)))?;

    let agents_dir = get_agents_dir_for_tools(&app).map_err(AppError::Config)?;
    let agent_dir = agents_dir.join(&folder_name);
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| AppError::Io(format!("Failed to create agent directory: {}", e)))?;

    let config_path = agent_dir.join("TOOL_CONFIG.json");
    std::fs::write(&config_path, &config)
        .map_err(|e| AppError::Io(format!("Failed to write TOOL_CONFIG.json: {}", e)))
}

pub(crate) fn get_agents_dir_for_tools(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_dir.join("agents"))
}

/// Normalize a TOOL_CONFIG.json: add missing native tools (disabled), ensure credentials
/// section exists, bump version to 2. Returns (normalized_json, changed).
pub fn normalize_tool_config(config_str: &str) -> Result<(String, bool), String> {
    let mut config: serde_json::Value = serde_json::from_str(config_str)
        .map_err(|e| format!("Invalid TOOL_CONFIG.json: {}", e))?;

    let mut changed = false;

    // Bump version to 2 if needed
    if config["version"].as_u64().unwrap_or(0) < 2 {
        config["version"] = serde_json::json!(2);
        changed = true;
    }

    // Ensure native section exists
    if config.get("native").and_then(|v| v.as_object()).is_none() {
        config["native"] = serde_json::json!({});
        changed = true;
    }

    // Migration: if write_file is enabled but delete_file is missing, enable delete_file too
    // (must run before "add missing" which would add it as disabled)
    if let Some(native) = config["native"].as_object_mut() {
        let write_file_enabled = native
            .get("write_file")
            .and_then(|v| v.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if write_file_enabled && !native.contains_key("delete_file") {
            native.insert(
                "delete_file".to_string(),
                serde_json::json!({ "enabled": true, "tier": "confirm" }),
            );
            changed = true;
        }
    }

    // Add missing native tools using each definition's `default_enabled` field
    // as the single source of truth for initial enablement.
    let defs = native_tool_definitions();
    if let Some(native) = config["native"].as_object_mut() {
        for def in &defs {
            if !native.contains_key(&def.name) {
                native.insert(
                    def.name.clone(),
                    serde_json::json!({ "enabled": def.default_enabled, "tier": def.default_tier }),
                );
                changed = true;
            }
        }

        // Migration: if a tool's schema says default_enabled=true but the config
        // has it disabled, force-enable it. This handles tools that were added
        // before their default_enabled was set to true (e.g., self-awareness tools).
        for def in &defs {
            if def.default_enabled {
                if let Some(entry) = native.get_mut(&def.name) {
                    if entry.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
                        entry["enabled"] = serde_json::json!(true);
                        changed = true;
                    }
                }
            }
        }
    }

    // Ensure auto_approve field exists (default: false)
    if config.get("auto_approve").is_none() {
        config["auto_approve"] = serde_json::json!(false);
        changed = true;
    }

    // Ensure credentials section exists
    if config.get("credentials").and_then(|v| v.as_object()).is_none() {
        config["credentials"] = serde_json::json!({});
        changed = true;
    }

    let result = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("JSON serialization error: {}", e))?;
    Ok((result, changed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_config_adds_delete_file_when_write_enabled() {
        let config = r#"{"version":2,"auto_approve":false,"native":{"read_file":{"enabled":true,"tier":"auto"},"write_file":{"enabled":true,"tier":"confirm"}},"credentials":{}}"#;
        let (normalized, changed) = normalize_tool_config(config).unwrap();
        assert!(changed);
        let parsed: serde_json::Value = serde_json::from_str(&normalized).unwrap();
        let delete = &parsed["native"]["delete_file"];
        assert_eq!(delete["enabled"], true);
        assert_eq!(delete["tier"], "confirm");
    }

    #[test]
    fn test_normalize_config_enables_delete_file_via_default_enabled() {
        let config = r#"{"version":2,"auto_approve":false,"native":{"read_file":{"enabled":true,"tier":"auto"},"write_file":{"enabled":false,"tier":"confirm"}},"credentials":{}}"#;
        let (normalized, changed) = normalize_tool_config(config).unwrap();
        // delete_file has default_enabled=true in schema, so it's added enabled
        let parsed: serde_json::Value = serde_json::from_str(&normalized).unwrap();
        let delete = &parsed["native"]["delete_file"];
        assert_eq!(delete["enabled"], true);
        assert!(changed);
    }
}
