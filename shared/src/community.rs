//! Community Hub API types — shared between relay-server and Tauri client.

use serde::{Deserialize, Serialize};

// ── Auth ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub peer_id: Option<String>,
}

// ── Persona ──

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersonaData {
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub soul: String,
    #[serde(default)]
    pub user_context: String,
    #[serde(default)]
    pub agents: String,
}

// ── Share requests ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareAgentRequest {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub original_agent_id: Option<String>,
    #[serde(default)]
    pub persona: Option<PersonaData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareSkillsRequest {
    #[serde(default)]
    pub agent_id: Option<String>,
    pub skills: Vec<ShareSkillItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareSkillItem {
    pub name: String,
    pub description: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareNotesRequest {
    #[serde(default)]
    pub agent_id: Option<String>,
    pub notes: Vec<ShareNoteItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareNoteItem {
    pub title: String,
    #[serde(default)]
    pub note_type: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub body: String,
}

// ── Shared content (responses) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedAgent {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub name: String,
    pub description: String,
    pub original_agent_id: Option<String>,
    pub persona: Option<PersonaData>,
    pub skills_count: i64,
    pub notes_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedSkill {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub skill_name: String,
    pub description: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedNote {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub title: String,
    pub note_type: String,
    pub tags: Vec<String>,
    pub body: String,
    pub created_at: String,
}

// ── Pagination ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginationParams {
    #[serde(default = "default_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
}

fn default_limit() -> u32 {
    20
}

// ── Update profile ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMeRequest {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub peer_id: Option<String>,
}
