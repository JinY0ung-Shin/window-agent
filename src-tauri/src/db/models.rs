use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

// ── Status parse error ─────────────────────────────────────

#[derive(Debug)]
pub struct ParseStatusError(String);

impl fmt::Display for ParseStatusError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown status: {}", self.0)
    }
}

impl std::error::Error for ParseStatusError {}

// ── TeamRunStatus ──────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamRunStatus {
    Running,
    WaitingReports,
    Synthesizing,
    Completed,
    Failed,
    Cancelled,
}

impl fmt::Display for TeamRunStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Running => write!(f, "running"),
            Self::WaitingReports => write!(f, "waiting_reports"),
            Self::Synthesizing => write!(f, "synthesizing"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl FromStr for TeamRunStatus {
    type Err = ParseStatusError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "running" => Ok(Self::Running),
            "waiting_reports" => Ok(Self::WaitingReports),
            "synthesizing" => Ok(Self::Synthesizing),
            "completed" | "done" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(ParseStatusError(other.to_string())),
        }
    }
}

impl Serialize for TeamRunStatus {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for TeamRunStatus {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

impl rusqlite::types::FromSql for TeamRunStatus {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse()
            .map_err(|e| rusqlite::types::FromSqlError::Other(Box::new(e)))
    }
}

impl rusqlite::types::ToSql for TeamRunStatus {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.to_string()))
    }
}

// ── TaskStatus ─────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Queued => write!(f, "queued"),
            Self::Running => write!(f, "running"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl FromStr for TaskStatus {
    type Err = ParseStatusError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "completed" | "done" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(ParseStatusError(other.to_string())),
        }
    }
}

impl Serialize for TaskStatus {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for TaskStatus {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

impl rusqlite::types::FromSql for TaskStatus {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse()
            .map_err(|e| rusqlite::types::FromSqlError::Other(Box::new(e)))
    }
}

impl rusqlite::types::ToSql for TaskStatus {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.to_string()))
    }
}

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
    pub status: TeamRunStatus,
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
    pub status: TaskStatus,
    pub parent_message_id: Option<String>,
    pub result_summary: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

// ── Cron models ──────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CronScheduleType {
    At,
    Every,
    Cron,
}

impl fmt::Display for CronScheduleType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::At => write!(f, "at"),
            Self::Every => write!(f, "every"),
            Self::Cron => write!(f, "cron"),
        }
    }
}

impl FromStr for CronScheduleType {
    type Err = ParseStatusError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "at" => Ok(Self::At),
            "every" => Ok(Self::Every),
            "cron" => Ok(Self::Cron),
            other => Err(ParseStatusError(other.to_string())),
        }
    }
}

impl Serialize for CronScheduleType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for CronScheduleType {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

impl rusqlite::types::FromSql for CronScheduleType {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse()
            .map_err(|e| rusqlite::types::FromSqlError::Other(Box::new(e)))
    }
}

impl rusqlite::types::ToSql for CronScheduleType {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.to_string()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CronRunResult {
    Success,
    Failed,
}

impl fmt::Display for CronRunResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Success => write!(f, "success"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

impl FromStr for CronRunResult {
    type Err = ParseStatusError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "success" => Ok(Self::Success),
            "failed" => Ok(Self::Failed),
            other => Err(ParseStatusError(other.to_string())),
        }
    }
}

impl Serialize for CronRunResult {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for CronRunResult {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

impl rusqlite::types::FromSql for CronRunResult {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse()
            .map_err(|e| rusqlite::types::FromSqlError::Other(Box::new(e)))
    }
}

impl rusqlite::types::ToSql for CronRunResult {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.to_string()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    pub description: String,
    pub schedule_type: CronScheduleType,
    pub schedule_value: String,
    pub prompt: String,
    pub enabled: bool,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub last_result: Option<CronRunResult>,
    pub last_error: Option<String>,
    pub run_count: i64,
    pub claimed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronRun {
    pub id: String,
    pub job_id: String,
    pub agent_id: String,
    pub status: String,
    pub prompt: String,
    pub result_summary: Option<String>,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCronJobRequest {
    pub agent_id: String,
    pub name: String,
    pub description: Option<String>,
    pub schedule_type: CronScheduleType,
    pub schedule_value: String,
    pub prompt: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCronJobRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub schedule_type: Option<CronScheduleType>,
    pub schedule_value: Option<String>,
    pub prompt: Option<String>,
    pub enabled: Option<bool>,
}
