use askama::Template;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse, Redirect, Response},
};
use pulldown_cmark::{Options, Parser};
use serde::Deserialize;

use crate::auth;
use crate::hub_db;
use crate::state::AppState;

// ── Cookie helper ──

fn secure_flag() -> &'static str {
    if std::env::var("COOKIE_INSECURE").is_ok() {
        ""
    } else {
        "; Secure"
    }
}

// ── Markdown rendering ──

fn render_markdown(input: &str) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS;
    let parser = Parser::new_ext(input, options);
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);
    ammonia::clean(&html)
}

// ── View structs (template-friendly, no Option) ──

#[allow(dead_code)]
struct AgentView {
    id: String,
    user_id: String,
    display_name: String,
    name: String,
    description: String,
    skills_count: i64,
    notes_count: i64,
    created_at: String,
}

impl From<hub_db::SharedAgentRow> for AgentView {
    fn from(r: hub_db::SharedAgentRow) -> Self {
        Self {
            id: r.id, user_id: r.user_id, display_name: r.display_name,
            name: r.name, description: r.description,
            skills_count: r.skills_count, notes_count: r.notes_count,
            created_at: r.created_at,
        }
    }
}

#[allow(dead_code)]
struct SkillView {
    id: String,
    user_id: String,
    display_name: String,
    agent_id: String,
    agent_name: String,
    skill_name: String,
    description: String,
    body: String,
}

impl From<hub_db::SharedSkillRow> for SkillView {
    fn from(r: hub_db::SharedSkillRow) -> Self {
        Self {
            id: r.id, user_id: r.user_id, display_name: r.display_name,
            agent_id: r.agent_id.unwrap_or_default(),
            agent_name: r.agent_name.unwrap_or_default(),
            skill_name: r.skill_name, description: r.description, body: r.body,
        }
    }
}

#[allow(dead_code)]
struct NoteView {
    id: String,
    user_id: String,
    display_name: String,
    agent_id: String,
    agent_name: String,
    title: String,
    note_type: String,
    tags_json: String,
}

impl From<hub_db::SharedNoteRow> for NoteView {
    fn from(r: hub_db::SharedNoteRow) -> Self {
        Self {
            id: r.id, user_id: r.user_id, display_name: r.display_name,
            agent_id: r.agent_id.unwrap_or_default(),
            agent_name: r.agent_name.unwrap_or_default(),
            title: r.title, note_type: r.note_type, tags_json: r.tags_json,
        }
    }
}

#[allow(dead_code)]
struct UserView {
    id: String,
    display_name: String,
    created_at: String,
}

impl From<hub_db::UserRow> for UserView {
    fn from(r: hub_db::UserRow) -> Self {
        Self { id: r.id, display_name: r.display_name, created_at: r.created_at }
    }
}

// ── Query params ──

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub offset: u32,
}

#[derive(Deserialize)]
pub struct AuthFormData {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

// ── Template structs ──

#[derive(Template)]
#[template(path = "landing.html")]
struct LandingTemplate {
    agents_count: u64,
    skills_count: u64,
    notes_count: u64,
    recent_agents: Vec<AgentView>,
    recent_skills: Vec<SkillView>,
    recent_notes: Vec<NoteView>,
}

#[derive(Template)]
#[template(path = "login.html")]
struct LoginTemplate {
    error: String,
}

#[derive(Template)]
#[template(path = "register.html")]
struct RegisterTemplate {
    error: String,
}

#[derive(Template)]
#[template(path = "agents.html")]
#[allow(dead_code)]
struct AgentsTemplate {
    agents: Vec<AgentView>,
    q: String,
    total: u64,
    has_prev: bool,
    has_next: bool,
    prev_offset: u32,
    next_offset: u32,
}

#[derive(Template)]
#[template(path = "agent_detail.html")]
struct AgentDetailTemplate {
    agent: AgentView,
    skills: Vec<SkillView>,
    notes: Vec<NoteView>,
}

#[derive(Template)]
#[template(path = "skills.html")]
#[allow(dead_code)]
struct SkillsTemplate {
    skills: Vec<SkillView>,
    q: String,
    total: u64,
    has_prev: bool,
    has_next: bool,
    prev_offset: u32,
    next_offset: u32,
}

#[derive(Template)]
#[template(path = "skill_detail.html")]
struct SkillDetailTemplate {
    skill: SkillView,
    body_html: String,
}

#[derive(Template)]
#[template(path = "notes.html")]
#[allow(dead_code)]
struct NotesTemplate {
    notes: Vec<NoteView>,
    q: String,
    total: u64,
    has_prev: bool,
    has_next: bool,
    prev_offset: u32,
    next_offset: u32,
}

#[derive(Template)]
#[template(path = "note_detail.html")]
struct NoteDetailTemplate {
    note: NoteView,
    tags: Vec<String>,
    body_html: String,
}

#[derive(Template)]
#[template(path = "user_profile.html")]
struct UserProfileTemplate {
    user: UserView,
    agents: Vec<AgentView>,
}

// ── Helper: render template or 500 ──

fn render<T: Template>(tmpl: T) -> Response {
    match tmpl.render() {
        Ok(html) => Html(html).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Template render failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
        }
    }
}

fn paginate(total: u64, limit: u32, offset: u32) -> (bool, bool, u32, u32) {
    let has_prev = offset > 0;
    let has_next = (offset as u64 + limit as u64) < total;
    let prev_offset = offset.saturating_sub(limit);
    let next_offset = offset.saturating_add(limit);
    (has_prev, has_next, prev_offset, next_offset)
}

// ── Handlers ──

pub async fn landing(State(state): State<AppState>) -> Response {
    let (ra, agents_count) =
        hub_db::list_shared_agents(state.db(), None, None, 6, 0).await.unwrap_or_default();
    let (rs, skills_count) =
        hub_db::list_shared_skills(state.db(), None, None, None, 6, 0).await.unwrap_or_default();
    let (rn, notes_count) =
        hub_db::list_shared_notes(state.db(), None, None, None, 6, 0).await.unwrap_or_default();

    render(LandingTemplate {
        agents_count,
        skills_count,
        notes_count,
        recent_agents: ra.into_iter().map(Into::into).collect(),
        recent_skills: rs.into_iter().map(Into::into).collect(),
        recent_notes: rn.into_iter().map(Into::into).collect(),
    })
}

pub async fn login_page() -> Response {
    render(LoginTemplate { error: String::new() })
}

pub async fn login_submit(
    State(state): State<AppState>,
    axum::Form(form): axum::Form<AuthFormData>,
) -> Response {
    if state.check_auth_rate(&form.email).await {
        return render(LoginTemplate { error: "Too many attempts. Try again later.".into() });
    }

    let user = match hub_db::get_user_by_email(state.db(), &form.email).await {
        Ok(Some(u)) => u,
        _ => return render(LoginTemplate { error: "Invalid email or password".into() }),
    };

    let valid = auth::verify_password(&form.password, &user.password_hash).unwrap_or(false);
    if !valid {
        return render(LoginTemplate { error: "Invalid email or password".into() });
    }

    let token = match auth::create_jwt(&user.id, &user.email, state.jwt_secret()) {
        Ok(t) => t,
        Err(_) => return render(LoginTemplate { error: "Server error".into() }),
    };

    let cookie = format!(
        "hub_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
        secure_flag()
    );
    ([("set-cookie", cookie)], Redirect::to("/")).into_response()
}

pub async fn register_page() -> Response {
    render(RegisterTemplate { error: String::new() })
}

pub async fn register_submit(
    State(state): State<AppState>,
    axum::Form(form): axum::Form<AuthFormData>,
) -> Response {
    if form.email.len() > 254 || !form.email.contains('@') {
        return render(RegisterTemplate { error: "Invalid email".into() });
    }
    if form.password.len() < 8 {
        return render(RegisterTemplate { error: "Password must be at least 8 characters".into() });
    }

    if state.check_auth_rate(&form.email).await {
        return render(RegisterTemplate { error: "Too many attempts. Try again later.".into() });
    }

    if let Ok(Some(_)) = hub_db::get_user_by_email(state.db(), &form.email).await {
        return render(RegisterTemplate { error: "Email already registered".into() });
    }

    let id = uuid::Uuid::new_v4().to_string();
    let password_hash = match auth::hash_password(&form.password) {
        Ok(h) => h,
        Err(_) => return render(RegisterTemplate { error: "Server error".into() }),
    };
    let display_name = form.display_name.as_deref().unwrap_or("");

    if hub_db::create_user(state.db(), &id, &form.email, &password_hash, display_name).await.is_err() {
        return render(RegisterTemplate { error: "Failed to create account".into() });
    }

    let token = match auth::create_jwt(&id, &form.email, state.jwt_secret()) {
        Ok(t) => t,
        Err(_) => return render(RegisterTemplate { error: "Server error".into() }),
    };

    let cookie = format!(
        "hub_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
        secure_flag()
    );
    ([("set-cookie", cookie)], Redirect::to("/")).into_response()
}

pub async fn agents_page(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Response {
    let limit = 20u32;
    let q = if params.q.is_empty() { None } else { Some(params.q.as_str()) };
    let (rows, total) =
        hub_db::list_shared_agents(state.db(), q, None, limit, params.offset).await.unwrap_or_default();
    let (has_prev, has_next, prev_offset, next_offset) = paginate(total, limit, params.offset);

    render(AgentsTemplate {
        agents: rows.into_iter().map(Into::into).collect(),
        q: params.q,
        total,
        has_prev, has_next, prev_offset, next_offset,
    })
}

pub async fn agent_detail_page(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let agent = match hub_db::get_shared_agent(state.db(), &id).await {
        Ok(Some(a)) => a,
        _ => return (StatusCode::NOT_FOUND, "Agent not found").into_response(),
    };

    let skills = hub_db::get_skills_by_agent(state.db(), &id).await.unwrap_or_default();
    let notes = hub_db::get_notes_by_agent(state.db(), &id).await.unwrap_or_default();

    render(AgentDetailTemplate {
        agent: agent.into(),
        skills: skills.into_iter().map(Into::into).collect(),
        notes: notes.into_iter().map(Into::into).collect(),
    })
}

pub async fn skills_page(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Response {
    let limit = 20u32;
    let q = if params.q.is_empty() { None } else { Some(params.q.as_str()) };
    let (rows, total) =
        hub_db::list_shared_skills(state.db(), q, None, None, limit, params.offset).await.unwrap_or_default();
    let (has_prev, has_next, prev_offset, next_offset) = paginate(total, limit, params.offset);

    render(SkillsTemplate {
        skills: rows.into_iter().map(Into::into).collect(),
        q: params.q,
        total,
        has_prev, has_next, prev_offset, next_offset,
    })
}

pub async fn skill_detail_page(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let skill = match hub_db::get_shared_skill(state.db(), &id).await {
        Ok(Some(s)) => s,
        _ => return (StatusCode::NOT_FOUND, "Skill not found").into_response(),
    };

    let body_html = render_markdown(&skill.body);
    let view: SkillView = skill.into();
    render(SkillDetailTemplate { skill: view, body_html })
}

pub async fn notes_page(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Response {
    let limit = 20u32;
    let q = if params.q.is_empty() { None } else { Some(params.q.as_str()) };
    let (rows, total) =
        hub_db::list_shared_notes(state.db(), q, None, None, limit, params.offset).await.unwrap_or_default();
    let (has_prev, has_next, prev_offset, next_offset) = paginate(total, limit, params.offset);

    render(NotesTemplate {
        notes: rows.into_iter().map(Into::into).collect(),
        q: params.q,
        total,
        has_prev, has_next, prev_offset, next_offset,
    })
}

pub async fn note_detail_page(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let note = match hub_db::get_shared_note(state.db(), &id).await {
        Ok(Some(n)) => n,
        _ => return (StatusCode::NOT_FOUND, "Note not found").into_response(),
    };

    let tags: Vec<String> = serde_json::from_str(&note.tags_json).unwrap_or_default();
    let body_html = render_markdown(&note.body);
    let view: NoteView = note.into();
    render(NoteDetailTemplate { note: view, tags, body_html })
}

pub async fn user_profile_page(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let user = match hub_db::get_user_by_id(state.db(), &id).await {
        Ok(Some(u)) => u,
        _ => return (StatusCode::NOT_FOUND, "User not found").into_response(),
    };

    let user_agents: Vec<AgentView> = hub_db::list_agents_by_user(state.db(), &id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(Into::into)
        .collect();

    render(UserProfileTemplate { user: user.into(), agents: user_agents })
}
