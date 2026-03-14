use serde::Serialize;

#[derive(Serialize)]
pub struct EnvConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
pub fn get_env_config() -> EnvConfig {
    EnvConfig {
        api_key: std::env::var("OPENAI_API_KEY").ok().filter(|s| !s.is_empty()),
        base_url: std::env::var("OPENAI_API_URL").ok().filter(|s| !s.is_empty()),
        model: std::env::var("OPENAI_MODEL").ok().filter(|s| !s.is_empty()),
    }
}
