//! Tauri commands for Community Hub — register, login, share, browse, delete.

use crate::error::AppError;
use crate::services::hub_client::{self, HubClient};
use crate::settings::AppSettings;
use serde::Serialize;
use tauri::State;
use wa_shared::community::UserInfo;

// ── Return types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HubAuthStatus {
    pub logged_in: bool,
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

// Re-export UserInfo as HubUserInfo for clarity at command boundary.
pub type HubUserInfo = UserInfo;

// ── Helpers ─────────────────────────────────────────────

fn make_hub_client(settings: &AppSettings) -> Result<HubClient, AppError> {
    let relay_url = settings.get().relay_url;
    Ok(HubClient::new(&relay_url, None))
}

fn make_authed_hub_client(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> Result<HubClient, AppError> {
    let relay_url = settings.get().relay_url;
    let auth = hub_client::load_hub_auth(app)
        .ok_or_else(|| AppError::Api("Not logged in to Community Hub".into()))?;
    Ok(HubClient::new(&relay_url, Some(auth.token)))
}

// ── Auth commands ───────────────────────────────────────

#[tauri::command]
pub async fn hub_register(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    email: String,
    password: String,
    display_name: Option<String>,
) -> Result<HubAuthStatus, AppError> {
    let client = make_hub_client(&settings)?;
    let resp = client
        .register(&email, &password, display_name.as_deref())
        .await?;

    hub_client::save_hub_auth(
        &app,
        &resp.token,
        &resp.user.id,
        &resp.user.email,
        &resp.user.display_name,
    )?;

    Ok(HubAuthStatus {
        logged_in: true,
        user_id: Some(resp.user.id),
        email: Some(resp.user.email),
        display_name: Some(resp.user.display_name),
    })
}

#[tauri::command]
pub async fn hub_login(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    email: String,
    password: String,
) -> Result<HubAuthStatus, AppError> {
    let client = make_hub_client(&settings)?;
    let resp = client.login(&email, &password).await?;

    hub_client::save_hub_auth(
        &app,
        &resp.token,
        &resp.user.id,
        &resp.user.email,
        &resp.user.display_name,
    )?;

    Ok(HubAuthStatus {
        logged_in: true,
        user_id: Some(resp.user.id),
        email: Some(resp.user.email),
        display_name: Some(resp.user.display_name),
    })
}

#[tauri::command]
pub fn hub_logout(app: tauri::AppHandle) -> Result<(), AppError> {
    // Server uses stateless JWT — no server-side revocation needed.
    hub_client::clear_hub_auth(&app)
}

#[tauri::command]
pub fn hub_get_auth_status(app: tauri::AppHandle) -> Result<HubAuthStatus, AppError> {
    match hub_client::load_hub_auth(&app) {
        Some(auth) => Ok(HubAuthStatus {
            logged_in: true,
            user_id: Some(auth.user_id),
            email: Some(auth.email),
            display_name: Some(auth.display_name),
        }),
        None => Ok(HubAuthStatus {
            logged_in: false,
            user_id: None,
            email: None,
            display_name: None,
        }),
    }
}

// ── Profile commands ────────────────────────────────────

#[tauri::command]
pub async fn hub_get_me(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
) -> Result<HubUserInfo, AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    client.get_me().await
}

#[tauri::command]
pub async fn hub_update_me(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    display_name: Option<String>,
    peer_id: Option<String>,
) -> Result<HubUserInfo, AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    let info = client
        .update_me(display_name.as_deref(), peer_id.as_deref())
        .await?;

    // Keep local auth store in sync with all profile fields
    if let Some(auth) = hub_client::load_hub_auth(&app) {
        hub_client::save_hub_auth(&app, &auth.token, &info.id, &info.email, &info.display_name)?;
    }

    Ok(info)
}

// ── Share commands ──────────────────────────────────────

#[tauri::command]
pub async fn hub_share_agent(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    name: String,
    description: String,
    original_agent_id: Option<String>,
) -> Result<wa_shared::community::SharedAgent, AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    client
        .share_agent(&name, &description, original_agent_id.as_deref())
        .await
}

#[tauri::command]
pub async fn hub_share_skills(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    agent_id: Option<String>,
    skills: Vec<wa_shared::community::ShareSkillItem>,
) -> Result<Vec<wa_shared::community::SharedSkill>, AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    client.share_skills(agent_id.as_deref(), skills).await
}

#[tauri::command]
pub async fn hub_share_notes(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    agent_id: Option<String>,
    notes: Vec<wa_shared::community::ShareNoteItem>,
) -> Result<Vec<wa_shared::community::SharedNote>, AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    client.share_notes(agent_id.as_deref(), notes).await
}

// ── List commands ───────────────────────────────────────

#[tauri::command]
pub async fn hub_list_agents(
    _app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    q: Option<String>,
    user_id: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<wa_shared::community::PaginatedResponse<wa_shared::community::SharedAgent>, AppError> {
    let client = make_hub_client(&settings)?;
    client.list_agents(q.as_deref(), user_id.as_deref(), limit, offset).await
}

#[tauri::command]
pub async fn hub_list_skills(
    _app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    q: Option<String>,
    agent_id: Option<String>,
    user_id: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<wa_shared::community::PaginatedResponse<wa_shared::community::SharedSkill>, AppError> {
    let client = make_hub_client(&settings)?;
    client
        .list_skills(q.as_deref(), agent_id.as_deref(), user_id.as_deref(), limit, offset)
        .await
}

#[tauri::command]
pub async fn hub_list_notes(
    _app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    q: Option<String>,
    agent_id: Option<String>,
    user_id: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<wa_shared::community::PaginatedResponse<wa_shared::community::SharedNote>, AppError> {
    let client = make_hub_client(&settings)?;
    client
        .list_notes(q.as_deref(), agent_id.as_deref(), user_id.as_deref(), limit, offset)
        .await
}

// ── Delete commands ─────────────────────────────────────

#[tauri::command]
pub async fn hub_delete_agent(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    id: String,
) -> Result<(), AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    client.delete_agent(&id).await
}

#[tauri::command]
pub async fn hub_delete_skill(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    id: String,
) -> Result<(), AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    client.delete_skill(&id).await
}

#[tauri::command]
pub async fn hub_delete_note(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    id: String,
) -> Result<(), AppError> {
    let client = make_authed_hub_client(&app, &settings)?;
    client.delete_note(&id).await
}
