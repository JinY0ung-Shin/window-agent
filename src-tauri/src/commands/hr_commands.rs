use crate::db::models::{self, Agent, Department};
use crate::AppState;
use chrono::Utc;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct CreateAgentRequest {
    pub id: String,
    pub name: String,
    pub role: String,
    pub department: String,
    pub personality: String,
    pub system_prompt: String,
    pub tools: String,
    pub model: String,
    pub avatar: String,
    #[serde(default = "default_ai_backend")]
    pub ai_backend: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_url: String,
}

fn default_ai_backend() -> String {
    "claude".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub department: Option<String>,
    pub personality: Option<String>,
    pub system_prompt: Option<String>,
    pub tools: Option<String>,
    pub model: Option<String>,
    pub avatar: Option<String>,
    pub ai_backend: Option<String>,
    pub api_key: Option<String>,
    pub api_url: Option<String>,
}

#[tauri::command]
pub fn hire_agent(
    state: State<AppState>,
    request: CreateAgentRequest,
) -> Result<Agent, String> {
    let now = Utc::now().to_rfc3339();
    let agent = Agent {
        id: request.id,
        name: request.name,
        role: request.role,
        department: request.department,
        personality: request.personality,
        system_prompt: request.system_prompt,
        tools: request.tools,
        status: "idle".to_string(),
        model: request.model,
        avatar: request.avatar,
        created_at: now.clone(),
        ai_backend: request.ai_backend,
        api_key: request.api_key,
        api_url: request.api_url,
        is_active: true,
        hired_at: Some(now),
        fired_at: None,
    };

    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::insert_agent(&conn, &agent).map_err(|e| e.to_string())?;
    Ok(agent)
}

#[tauri::command]
pub fn fire_agent(
    state: State<AppState>,
    agent_id: String,
) -> Result<bool, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::fire_agent(&conn, &agent_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_agent(
    state: State<AppState>,
    agent_id: String,
    request: UpdateAgentRequest,
) -> Result<Agent, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;

    let mut agent = models::get_agent_by_id(&conn, &agent_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

    if let Some(name) = request.name { agent.name = name; }
    if let Some(role) = request.role { agent.role = role; }
    if let Some(department) = request.department { agent.department = department; }
    if let Some(personality) = request.personality { agent.personality = personality; }
    if let Some(system_prompt) = request.system_prompt { agent.system_prompt = system_prompt; }
    if let Some(tools) = request.tools { agent.tools = tools; }
    if let Some(model) = request.model { agent.model = model; }
    if let Some(avatar) = request.avatar { agent.avatar = avatar; }
    if let Some(ai_backend) = request.ai_backend { agent.ai_backend = ai_backend; }
    if let Some(api_key) = request.api_key { agent.api_key = api_key; }
    if let Some(api_url) = request.api_url { agent.api_url = api_url; }

    models::update_agent(&conn, &agent).map_err(|e| e.to_string())?;
    Ok(agent)
}

#[tauri::command]
pub fn get_departments(state: State<AppState>) -> Result<Vec<Department>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_all_departments(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_department(
    state: State<AppState>,
    name: String,
    description: String,
) -> Result<Department, String> {
    let dept = Department {
        id: models::new_id(),
        name,
        description,
        created_at: Utc::now().to_rfc3339(),
    };
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::insert_department(&conn, &dept).map_err(|e| e.to_string())?;
    Ok(dept)
}
