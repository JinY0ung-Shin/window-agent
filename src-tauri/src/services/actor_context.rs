use crate::db::agent_operations;
use crate::db::models::Agent;
use crate::db::Database;
use crate::error::AppError;
use serde_json;

// ── Enums ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // TODO: wire into stream handler to branch DM vs team execution paths
pub enum ExecutionRole {
    /// Single-agent (direct message) mode
    Dm,
    /// Leader of a team run
    TeamLeader,
    /// Member executing a delegated task
    TeamMember,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // TODO: use in execution scope to determine context injection strategy
pub enum ExecutionTrigger {
    /// Initiated by a user message
    UserInitiated,
    /// Initiated by backend orchestration (e.g. team leader delegating)
    BackendTriggered,
}

// ── ExecutionScope ─────────────────────────────────────────

/// Describes *who* is acting and *why*, before any DB lookups.
#[derive(Debug, Clone)]
#[allow(dead_code)] // TODO: consume fields in unified stream handler to replace ad-hoc arg passing
pub struct ExecutionScope {
    pub actor_agent_id: String,
    pub conversation_id: String,
    pub team_id: Option<String>,
    pub team_run_id: Option<String>,
    pub team_task_id: Option<String>,
    pub role: ExecutionRole,
    pub trigger: ExecutionTrigger,
}

// ── ResolvedContext ────────────────────────────────────────

/// Fully resolved execution context ready for an LLM turn.
#[derive(Debug, Clone)]
#[allow(dead_code)] // TODO: pass to LLM call site to replace individual parameter threading
pub struct ResolvedContext {
    pub agent: Agent,
    pub system_prompt: String,
    pub enabled_tool_names: Vec<String>,
    pub workspace_path: Option<String>,
    pub model: String,
    pub temperature: Option<f64>,
    pub thinking_enabled: bool,
    pub thinking_budget: Option<i64>,
}

// ── Default LLM settings ──────────────────────────────────

const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4-20250514";

// ── Orchestration tool names ──────────────────────────────

const TOOL_DELEGATE: &str = "delegate";
const TOOL_REPORT: &str = "report";

// ── resolve() ──────────────────────────────────────────────

/// Resolve an [`ExecutionScope`] into a [`ResolvedContext`] by loading the
/// agent from DB, assembling persona files, and filtering tools by role.
pub fn resolve(
    scope: &ExecutionScope,
    db: &Database,
    app_data_dir: &std::path::Path,
) -> Result<ResolvedContext, AppError> {
    // 1. Load agent record
    let agent = agent_operations::get_agent_impl(db, scope.actor_agent_id.clone())?;

    // 2. Read persona files from the agent's folder
    let agent_dir = app_data_dir.join("agents").join(&agent.folder_name);
    let system_prompt = assemble_system_prompt(&agent_dir);

    // 3. Determine enabled tools based on role + trigger + TOOL_CONFIG.json
    let enabled_tool_names = resolve_tool_names(&scope.role, &scope.trigger, &agent_dir);

    // 4. Derive workspace path (agent-scoped working directory)
    let workspace_path = if agent_dir.exists() {
        let ws_dir = agent_dir.join("workspace");
        let _ = std::fs::create_dir_all(&ws_dir);
        Some(ws_dir.to_string_lossy().to_string())
    } else {
        None
    };

    // 5. LLM settings — agent-level with global fallback
    let model = agent
        .model
        .clone()
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let temperature = agent.temperature;
    let thinking_enabled = agent.thinking_enabled.unwrap_or(false);
    let thinking_budget = agent.thinking_budget;

    Ok(ResolvedContext {
        agent,
        system_prompt,
        enabled_tool_names,
        workspace_path,
        model,
        temperature,
        thinking_enabled,
        thinking_budget,
    })
}

// ── Persona assembly (best-effort) ────────────────────────

/// Read and concatenate persona markdown files from the agent's directory.
/// Missing files are silently skipped — this is intentional so that agents
/// work even before persona files are created.
fn assemble_system_prompt(agent_dir: &std::path::Path) -> String {
    let files = ["IDENTITY.md", "SOUL.md"];
    let mut parts: Vec<String> = Vec::new();

    for fname in &files {
        let path = agent_dir.join(fname);
        if let Ok(content) = std::fs::read_to_string(&path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
    }

    parts.join("\n\n")
}

// ── Tool config reading ─────────────────────────────────────

/// Read TOOL_CONFIG.json from the agent's directory and return enabled native
/// tools as `(tool_name, tier)` pairs.  Orchestration tools ("delegate",
/// "report") are excluded — they are added explicitly based on role.
fn read_tool_config(agent_dir: &std::path::Path) -> Vec<(String, String)> {
    let config_path = agent_dir.join("TOOL_CONFIG.json");
    let raw = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let config: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut tools = Vec::new();
    if let Some(native) = config.get("native").and_then(|v| v.as_object()) {
        for (name, entry) in native {
            // Skip orchestration tools — they are managed separately
            if name == TOOL_DELEGATE || name == TOOL_REPORT {
                continue;
            }
            let enabled = entry
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if enabled {
                let tier = entry
                    .get("tier")
                    .and_then(|v| v.as_str())
                    .unwrap_or("confirm")
                    .to_string();
                tools.push((name.clone(), tier));
            }
        }
    }
    tools
}

// ── Tool filtering ─────────────────────────────────────────

/// Return the list of enabled tool names based on execution role, trigger, and
/// the agent's TOOL_CONFIG.json.
///
/// For Dm mode we return an empty vec (meaning "use whatever the frontend
/// provides"). For team modes we read the agent's config and filter by tier.
fn resolve_tool_names(
    role: &ExecutionRole,
    trigger: &ExecutionTrigger,
    agent_dir: &std::path::Path,
) -> Vec<String> {
    match role {
        // DM — full tool access; empty vec signals "use default frontend config"
        ExecutionRole::Dm => Vec::new(),

        // Team member — report only for v1. Auto-tier tool support (read_file,
        // list_directory, etc.) will be added in v2 when the execution loop can
        // actually invoke them.
        ExecutionRole::TeamMember => {
            vec![TOOL_REPORT.to_string()]
        }

        // Team leader
        ExecutionRole::TeamLeader => match trigger {
            // User-initiated: all enabled tools + delegate
            ExecutionTrigger::UserInitiated => {
                let config_tools = read_tool_config(agent_dir);
                let mut tools: Vec<String> =
                    config_tools.into_iter().map(|(name, _)| name).collect();
                tools.push(TOOL_DELEGATE.to_string());
                tools
            }
            // Backend-triggered (synthesis): auto-tier tools + delegate
            ExecutionTrigger::BackendTriggered => {
                let config_tools = read_tool_config(agent_dir);
                let mut tools: Vec<String> = config_tools
                    .into_iter()
                    .filter(|(_, tier)| tier == "auto")
                    .map(|(name, _)| name)
                    .collect();
                tools.push(TOOL_DELEGATE.to_string());
                tools
            }
        },
    }
}

// ── Tests ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::agent_operations::create_agent_impl;
    use crate::db::models::CreateAgentRequest;
    use crate::db::Database;
    use std::fs;
    use tempfile::TempDir;

    fn setup() -> (Database, TempDir, String) {
        let db = Database::new_in_memory().expect("in-memory db");
        let tmp = TempDir::new().expect("tempdir");

        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                folder_name: "test-agent".into(),
                name: "Test Agent".into(),
                avatar: None,
                description: Some("A test agent".into()),
                model: Some("gpt-4o".into()),
                temperature: Some(0.7),
                thinking_enabled: Some(true),
                thinking_budget: Some(8000),
                is_default: None,
                sort_order: None,
            },
        )
        .expect("create agent");

        // Create persona files
        let agent_dir = tmp.path().join("agents").join("test-agent");
        fs::create_dir_all(&agent_dir).unwrap();
        fs::write(agent_dir.join("IDENTITY.md"), "You are a test agent.").unwrap();
        fs::write(agent_dir.join("SOUL.md"), "Be helpful.").unwrap();

        // Create TOOL_CONFIG.json with a mix of auto/confirm tools
        let tool_config = serde_json::json!({
            "version": 2,
            "auto_approve": false,
            "native": {
                "read_file": { "enabled": true, "tier": "auto" },
                "write_file": { "enabled": true, "tier": "confirm" },
                "list_directory": { "enabled": true, "tier": "auto" },
                "web_search": { "enabled": false, "tier": "confirm" },
                "delegate": { "enabled": true, "tier": "auto" },
                "report": { "enabled": true, "tier": "auto" }
            },
            "credentials": {}
        });
        fs::write(
            agent_dir.join("TOOL_CONFIG.json"),
            serde_json::to_string_pretty(&tool_config).unwrap(),
        )
        .unwrap();

        (db, tmp, agent.id)
    }

    #[test]
    fn test_resolve_dm() {
        let (db, tmp, agent_id) = setup();
        let scope = ExecutionScope {
            actor_agent_id: agent_id,
            conversation_id: "conv-1".into(),
            team_id: None,
            team_run_id: None,
            team_task_id: None,
            role: ExecutionRole::Dm,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let ctx = resolve(&scope, &db, tmp.path()).unwrap();

        assert_eq!(ctx.agent.name, "Test Agent");
        assert_eq!(ctx.model, "gpt-4o");
        assert_eq!(ctx.temperature, Some(0.7));
        assert!(ctx.thinking_enabled);
        assert_eq!(ctx.thinking_budget, Some(8000));
        assert!(ctx.system_prompt.contains("You are a test agent."));
        assert!(ctx.system_prompt.contains("Be helpful."));
        // DM mode returns empty tool list (frontend provides)
        assert!(ctx.enabled_tool_names.is_empty());
        // Workspace path should point to the workspace subdirectory
        let ws = ctx.workspace_path.unwrap();
        assert!(ws.ends_with("workspace"));
    }

    #[test]
    fn test_resolve_team_member() {
        let (db, tmp, agent_id) = setup();
        let scope = ExecutionScope {
            actor_agent_id: agent_id,
            conversation_id: "conv-1".into(),
            team_id: Some("team-1".into()),
            team_run_id: Some("run-1".into()),
            team_task_id: Some("task-1".into()),
            role: ExecutionRole::TeamMember,
            trigger: ExecutionTrigger::BackendTriggered,
        };

        let ctx = resolve(&scope, &db, tmp.path()).unwrap();

        // v1: TeamMember only gets "report" — no auto-tier tools yet
        assert_eq!(ctx.enabled_tool_names, vec!["report".to_string()]);
    }

    #[test]
    fn test_resolve_team_leader_user_initiated() {
        let (db, tmp, agent_id) = setup();
        let scope = ExecutionScope {
            actor_agent_id: agent_id,
            conversation_id: "conv-1".into(),
            team_id: Some("team-1".into()),
            team_run_id: Some("run-1".into()),
            team_task_id: None,
            role: ExecutionRole::TeamLeader,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let ctx = resolve(&scope, &db, tmp.path()).unwrap();

        // User-initiated leader: all enabled tools (any tier) + delegate
        assert!(ctx.enabled_tool_names.contains(&"delegate".to_string()));
        assert!(ctx.enabled_tool_names.contains(&"read_file".to_string()));
        assert!(ctx.enabled_tool_names.contains(&"write_file".to_string()));
        assert!(ctx.enabled_tool_names.contains(&"list_directory".to_string()));
        // Disabled tools should not appear
        assert!(!ctx.enabled_tool_names.contains(&"web_search".to_string()));
        assert!(!ctx.enabled_tool_names.contains(&"report".to_string()));
    }

    #[test]
    fn test_resolve_team_leader_backend_triggered() {
        let (db, tmp, agent_id) = setup();
        let scope = ExecutionScope {
            actor_agent_id: agent_id,
            conversation_id: "conv-1".into(),
            team_id: Some("team-1".into()),
            team_run_id: Some("run-1".into()),
            team_task_id: None,
            role: ExecutionRole::TeamLeader,
            trigger: ExecutionTrigger::BackendTriggered,
        };

        let ctx = resolve(&scope, &db, tmp.path()).unwrap();

        // Backend-triggered leader: auto-tier tools only + delegate
        assert!(ctx.enabled_tool_names.contains(&"delegate".to_string()));
        assert!(ctx.enabled_tool_names.contains(&"read_file".to_string()));
        assert!(ctx.enabled_tool_names.contains(&"list_directory".to_string()));
        // Confirm-tier tools should NOT appear
        assert!(!ctx.enabled_tool_names.contains(&"write_file".to_string()));
        assert!(!ctx.enabled_tool_names.contains(&"report".to_string()));
    }

    #[test]
    fn test_resolve_missing_persona_files() {
        let db = Database::new_in_memory().expect("in-memory db");
        let tmp = TempDir::new().expect("tempdir");

        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                folder_name: "empty-agent".into(),
                name: "Empty".into(),
                avatar: None,
                description: None,
                model: None,
                temperature: None,
                thinking_enabled: None,
                thinking_budget: None,
                is_default: None,
                sort_order: None,
            },
        )
        .expect("create agent");

        let scope = ExecutionScope {
            actor_agent_id: agent.id,
            conversation_id: "conv-1".into(),
            team_id: None,
            team_run_id: None,
            team_task_id: None,
            role: ExecutionRole::Dm,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let ctx = resolve(&scope, &db, tmp.path()).unwrap();

        // No persona files → empty prompt, but no error
        assert!(ctx.system_prompt.is_empty());
        // No agent dir → no workspace path
        assert!(ctx.workspace_path.is_none());
        // Fallback model
        assert_eq!(ctx.model, DEFAULT_MODEL);
        assert!(!ctx.thinking_enabled);
    }

    #[test]
    fn test_resolve_agent_not_found() {
        let db = Database::new_in_memory().expect("in-memory db");
        let tmp = TempDir::new().expect("tempdir");

        let scope = ExecutionScope {
            actor_agent_id: "nonexistent".into(),
            conversation_id: "conv-1".into(),
            team_id: None,
            team_run_id: None,
            team_task_id: None,
            role: ExecutionRole::Dm,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let result = resolve(&scope, &db, tmp.path());
        assert!(result.is_err());
    }
}
