use serde::Serialize;

#[derive(Serialize)]
pub struct EnvConfig {
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
pub fn get_env_config() -> EnvConfig {
    EnvConfig {
        base_url: std::env::var("OPENAI_API_URL").ok().filter(|s| !s.is_empty()),
        model: std::env::var("OPENAI_MODEL").ok().filter(|s| !s.is_empty()),
    }
}
