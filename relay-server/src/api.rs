use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use wa_shared::community::*;

use crate::auth::{self, AuthUser};
use crate::hub_db;
use crate::state::AppState;

/// JSON error response.
#[derive(serde::Serialize)]
pub struct ApiError {
    error: String,
}

fn err(status: StatusCode, msg: &str) -> (StatusCode, Json<ApiError>) {
    (status, Json(ApiError { error: msg.to_string() }))
}

// ── Auth ──

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ApiError>)> {
    // Validation
    if req.email.len() > 254 || !req.email.contains('@') {
        return Err(err(StatusCode::BAD_REQUEST, "Invalid email"));
    }
    if req.password.len() < 8 {
        return Err(err(StatusCode::BAD_REQUEST, "Password must be at least 8 characters"));
    }

    // Rate limit
    if state.check_auth_rate(&req.email).await {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts. Try again later."));
    }

    // Check existing
    if hub_db::get_user_by_email(state.db(), &req.email).await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        .is_some()
    {
        return Err(err(StatusCode::CONFLICT, "Email already registered"));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let password_hash = auth::hash_password(&req.password)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to hash password"))?;
    let display_name = req.display_name.as_deref().unwrap_or("");

    hub_db::create_user(state.db(), &id, &req.email, &password_hash, display_name)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create user"))?;

    let token = auth::create_jwt(&id, &req.email, state.jwt_secret())
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create token"))?;

    Ok(Json(AuthResponse {
        token,
        user: UserInfo {
            id,
            email: req.email,
            display_name: display_name.to_string(),
            peer_id: None,
        },
    }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ApiError>)> {
    // Rate limit
    if state.check_auth_rate(&req.email).await {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts. Try again later."));
    }

    let user = hub_db::get_user_by_email(state.db(), &req.email)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Invalid email or password"))?;

    let valid = auth::verify_password(&req.password, &user.password_hash)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Password verification failed"))?;

    if !valid {
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid email or password"));
    }

    let token = auth::create_jwt(&user.id, &user.email, state.jwt_secret())
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create token"))?;

    Ok(Json(AuthResponse {
        token,
        user: UserInfo {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            peer_id: user.peer_id,
        },
    }))
}

// ── Me ──

pub async fn get_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<UserInfo>, (StatusCode, Json<ApiError>)> {
    let user = hub_db::get_user_by_id(state.db(), &auth.user_id)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "User not found"))?;

    Ok(Json(UserInfo {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        peer_id: user.peer_id,
    }))
}

pub async fn update_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UpdateMeRequest>,
) -> Result<Json<UserInfo>, (StatusCode, Json<ApiError>)> {
    hub_db::update_user(
        state.db(),
        &auth.user_id,
        req.display_name.as_deref(),
        req.peer_id.as_deref(),
    )
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    get_me(State(state), auth).await
}

// ── Share agent ──

pub async fn share_agent(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ShareAgentRequest>,
) -> Result<Json<SharedAgent>, (StatusCode, Json<ApiError>)> {
    if req.name.is_empty() || req.name.len() > 200 {
        return Err(err(StatusCode::BAD_REQUEST, "Agent name must be 1-200 characters"));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let actual_id = hub_db::upsert_shared_agent(
        state.db(),
        &id,
        &auth.user_id,
        &req.name,
        &req.description,
        req.original_agent_id.as_deref(),
    )
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to share agent"))?;

    let agent = hub_db::get_shared_agent(state.db(), &actual_id)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        .ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "Agent not found after insert"))?;

    Ok(Json(agent_row_to_response(agent)))
}

// ── Share skills ──

pub async fn share_skills(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ShareSkillsRequest>,
) -> Result<Json<Vec<SharedSkill>>, (StatusCode, Json<ApiError>)> {
    if req.skills.len() > 50 {
        return Err(err(StatusCode::BAD_REQUEST, "Maximum 50 skills per request"));
    }

    let mut results = Vec::new();
    for item in &req.skills {
        if item.body.len() > 100 * 1024 {
            return Err(err(StatusCode::BAD_REQUEST, "Skill body exceeds 100KB limit"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        hub_db::create_shared_skill(
            state.db(),
            &id,
            &auth.user_id,
            req.agent_id.as_deref(),
            &item.name,
            &item.description,
            &item.body,
        )
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to share skill"))?;

        if let Some(row) = hub_db::get_shared_skill(state.db(), &id).await
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        {
            results.push(skill_row_to_response(row));
        }
    }

    Ok(Json(results))
}

// ── Share notes ──

pub async fn share_notes(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ShareNotesRequest>,
) -> Result<Json<Vec<SharedNote>>, (StatusCode, Json<ApiError>)> {
    if req.notes.len() > 50 {
        return Err(err(StatusCode::BAD_REQUEST, "Maximum 50 notes per request"));
    }

    let mut results = Vec::new();
    for item in &req.notes {
        if item.body.len() > 100 * 1024 {
            return Err(err(StatusCode::BAD_REQUEST, "Note body exceeds 100KB limit"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let tags_json = serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".to_string());
        hub_db::create_shared_note(
            state.db(),
            &id,
            &auth.user_id,
            req.agent_id.as_deref(),
            &item.title,
            &item.note_type,
            &tags_json,
            &item.body,
        )
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to share note"))?;

        if let Some(row) = hub_db::get_shared_note(state.db(), &id).await
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        {
            results.push(note_row_to_response(row));
        }
    }

    Ok(Json(results))
}

// ── List endpoints (public) ──

pub async fn list_agents(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<SharedAgent>>, (StatusCode, Json<ApiError>)> {
    let limit = params.limit.min(50);
    let (rows, total) = hub_db::list_shared_agents(state.db(), params.q.as_deref(), limit, params.offset)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(PaginatedResponse {
        items: rows.into_iter().map(agent_row_to_response).collect(),
        total,
        limit,
        offset: params.offset,
    }))
}

pub async fn list_skills(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<SharedSkill>>, (StatusCode, Json<ApiError>)> {
    let limit = params.limit.min(50);
    let (rows, total) = hub_db::list_shared_skills(
        state.db(),
        params.q.as_deref(),
        params.agent_id.as_deref(),
        limit,
        params.offset,
    )
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(PaginatedResponse {
        items: rows.into_iter().map(skill_row_to_response).collect(),
        total,
        limit,
        offset: params.offset,
    }))
}

pub async fn list_notes(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<SharedNote>>, (StatusCode, Json<ApiError>)> {
    let limit = params.limit.min(50);
    let (rows, total) = hub_db::list_shared_notes(
        state.db(),
        params.q.as_deref(),
        params.agent_id.as_deref(),
        limit,
        params.offset,
    )
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(PaginatedResponse {
        items: rows.into_iter().map(note_row_to_response).collect(),
        total,
        limit,
        offset: params.offset,
    }))
}

// ── Delete endpoints ──

pub async fn delete_agent(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    let deleted = hub_db::delete_shared_agent(state.db(), &id, &auth.user_id)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(err(StatusCode::NOT_FOUND, "Agent not found or not owned by you"))
    }
}

pub async fn delete_skill(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    let deleted = hub_db::delete_shared_skill(state.db(), &id, &auth.user_id)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(err(StatusCode::NOT_FOUND, "Skill not found or not owned by you"))
    }
}

pub async fn delete_note(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    let deleted = hub_db::delete_shared_note(state.db(), &id, &auth.user_id)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(err(StatusCode::NOT_FOUND, "Note not found or not owned by you"))
    }
}

// ── Row → Response converters ──

fn agent_row_to_response(row: hub_db::SharedAgentRow) -> SharedAgent {
    SharedAgent {
        id: row.id,
        user_id: row.user_id,
        display_name: row.display_name,
        name: row.name,
        description: row.description,
        original_agent_id: row.original_agent_id,
        skills_count: row.skills_count,
        notes_count: row.notes_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn skill_row_to_response(row: hub_db::SharedSkillRow) -> SharedSkill {
    SharedSkill {
        id: row.id,
        user_id: row.user_id,
        display_name: row.display_name,
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        skill_name: row.skill_name,
        description: row.description,
        body: row.body,
        created_at: row.created_at,
    }
}

fn note_row_to_response(row: hub_db::SharedNoteRow) -> SharedNote {
    let tags: Vec<String> = serde_json::from_str(&row.tags_json).unwrap_or_default();
    SharedNote {
        id: row.id,
        user_id: row.user_id,
        display_name: row.display_name,
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        title: row.title,
        note_type: row.note_type,
        tags,
        body: row.body,
        created_at: row.created_at,
    }
}
