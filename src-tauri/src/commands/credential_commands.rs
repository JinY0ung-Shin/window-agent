use crate::error::AppError;
use crate::services::credential_service::{self, CredentialMeta};
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Deserialize)]
pub struct AddCredentialRequest {
    pub id: String,
    pub name: String,
    pub value: String,
    pub allowed_hosts: Vec<String>,
}

#[derive(Deserialize)]
pub struct UpdateCredentialRequest {
    pub id: String,
    pub name: Option<String>,
    pub value: Option<String>,
    pub allowed_hosts: Option<Vec<String>>,
}

/// List all credential metadata. Values are never returned.
#[tauri::command]
pub fn list_credentials(app: AppHandle) -> Result<Vec<CredentialMeta>, AppError> {
    credential_service::list_credentials(&app).map_err(AppError::Config)
}

/// Add a new credential with its secret value and allowed hosts.
#[tauri::command]
pub fn add_credential(
    app: AppHandle,
    request: AddCredentialRequest,
) -> Result<CredentialMeta, AppError> {
    credential_service::add_credential(
        &app,
        &request.id,
        &request.name,
        &request.value,
        request.allowed_hosts,
    ).map_err(AppError::Config)
}

/// Update an existing credential. Only provided fields are changed.
#[tauri::command]
pub fn update_credential(
    app: AppHandle,
    request: UpdateCredentialRequest,
) -> Result<CredentialMeta, AppError> {
    credential_service::update_credential(
        &app,
        &request.id,
        request.name.as_deref(),
        request.value.as_deref(),
        request.allowed_hosts,
    ).map_err(AppError::Config)
}

/// Remove a credential and its secret.
#[tauri::command]
pub fn remove_credential(app: AppHandle, id: String) -> Result<(), AppError> {
    credential_service::remove_credential(&app, &id).map_err(AppError::Config)
}
