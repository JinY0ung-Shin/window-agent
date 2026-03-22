use crate::utils::config_helpers::read_env_non_empty;
use serde::Serialize;

#[derive(Serialize)]
pub struct EnvConfig {
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
pub fn get_env_config() -> EnvConfig {
    EnvConfig {
        base_url: read_env_non_empty("OPENAI_API_URL"),
        model: read_env_non_empty("OPENAI_MODEL"),
    }
}
