use crate::error::AppError;
use crate::settings::{AppSettings, AppSettingsInner, AppSettingsPatch};
use crate::utils::config_helpers::read_env_non_empty;
use serde::Serialize;
use tauri::State;

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

#[tauri::command]
pub fn get_app_settings(settings: State<'_, AppSettings>) -> AppSettingsInner {
    settings.get()
}

#[tauri::command]
pub fn set_app_settings(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    patch: AppSettingsPatch,
) -> Result<(), AppError> {
    settings.set(&patch, &app)
}

#[tauri::command]
pub fn migrate_frontend_settings(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    values: serde_json::Value,
) -> Result<(), AppError> {
    settings.migrate_from_frontend(&values, &app)
}
