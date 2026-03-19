use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub folder_name: String,
    pub name: String,
    pub avatar: Option<String>,
    pub description: String,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget: Option<i64>,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgentRequest {
    pub folder_name: String,
    pub name: String,
    pub avatar: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget: Option<i64>,
    pub is_default: Option<bool>,
    pub sort_order: Option<i64>,
}

/// For nullable agent fields, `Option<Option<T>>` distinguishes:
/// - `None` (field absent) → keep current value
/// - `Some(None)` (field is `null`) → reset to null
/// - `Some(Some(v))` → set to new value
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAgentRequest {
    pub name: Option<String>,
    #[serde(default)]
    pub avatar: Option<Option<String>>,
    pub description: Option<String>,
    #[serde(default)]
    pub model: Option<Option<String>>,
    #[serde(default)]
    pub temperature: Option<Option<f64>>,
    #[serde(default)]
    pub thinking_enabled: Option<Option<bool>>,
    #[serde(default)]
    pub thinking_budget: Option<Option<i64>>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListItem {
    pub id: String,
    pub title: String,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationDetail {
    pub id: String,
    pub title: String,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    pub summary: Option<String>,
    pub summary_up_to_message_id: Option<String>,
    /// Serialized as a proper JSON array to the frontend, stored as JSON text in DB.
    pub active_skills: Option<Vec<String>>,
    #[serde(default)]
    pub learning_mode: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consolidated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteMessagesResult {
    pub summary_was_reset: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_task_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveMessageRequest {
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    #[serde(default)]
    pub sender_agent_id: Option<String>,
    #[serde(default)]
    pub team_run_id: Option<String>,
    #[serde(default)]
    pub team_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserArtifact {
    pub id: String,
    pub session_id: String,
    pub conversation_id: String,
    pub snapshot_full: String,
    pub ref_map_json: String,
    pub url: String,
    pub title: String,
    pub screenshot_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallLog {
    pub id: String,
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub tool_name: String,
    pub tool_input: String,
    pub tool_output: Option<String>,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub artifact_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub created_at: String,
}

// ── Team models ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub description: String,
    pub leader_agent_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub id: String,
    pub team_id: String,
    pub agent_id: String,
    pub role: String,
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamDetail {
    pub team: Team,
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub leader_agent_id: String,
    #[serde(default)]
    pub member_agent_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTeamRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub leader_agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamRun {
    pub id: String,
    pub team_id: String,
    pub conversation_id: String,
    pub leader_agent_id: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamTask {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub request_id: Option<String>,
    pub task_description: String,
    pub status: String,
    pub parent_message_id: Option<String>,
    pub result_summary: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}
