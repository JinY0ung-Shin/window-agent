use crate::error::AppError;
use std::path::PathBuf;
use tauri::Manager;

/// Resolve the user's home directory.
pub fn home_dir() -> Result<PathBuf, AppError> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| AppError::Io("HOME environment variable not set".to_string()))
}

/// Resolve the Claude Code plugins cache directory (`~/.claude/plugins`).
pub fn cc_plugins_dir() -> Result<PathBuf, AppError> {
    Ok(home_dir()?.join(".claude/plugins"))
}

/// Resolve the app data directory from a Tauri AppHandle.
///
/// This is the single source of truth for `app.path().app_data_dir()` resolution,
/// replacing the identical `map_err` boilerplate that was duplicated across
/// agent_commands, skill_commands, tool_commands/config, and credential_service.
pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}

/// Resolve the agents directory (`<app_data_dir>/agents`).
///
/// Consolidates three identical private helpers:
/// - `agent_commands::get_agents_dir`
/// - `skill_commands::get_agents_dir`
/// - `tool_commands/config::get_agents_dir_for_tools`
pub fn agents_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("agents"))
}

/// Read an environment variable, returning `None` if unset or empty.
///
/// Consolidates the repeated `std::env::var(key).ok().filter(|s| !s.is_empty())`
/// pattern used in config_commands and api.rs.
pub fn read_env_non_empty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_env_non_empty_missing() {
        // Use a key that is very unlikely to be set
        assert!(read_env_non_empty("__WINDOW_AGENT_TEST_NONEXISTENT__").is_none());
    }

    #[test]
    fn test_read_env_non_empty_set() {
        std::env::set_var("__WINDOW_AGENT_TEST_SET__", "hello");
        assert_eq!(
            read_env_non_empty("__WINDOW_AGENT_TEST_SET__"),
            Some("hello".to_string())
        );
        std::env::remove_var("__WINDOW_AGENT_TEST_SET__");
    }

    #[test]
    fn test_read_env_non_empty_empty_string() {
        std::env::set_var("__WINDOW_AGENT_TEST_EMPTY__", "");
        assert!(read_env_non_empty("__WINDOW_AGENT_TEST_EMPTY__").is_none());
        std::env::remove_var("__WINDOW_AGENT_TEST_EMPTY__");
    }
}
