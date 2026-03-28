use crate::db::agent_operations;
use crate::db::Database;
use crate::error::AppError;
use crate::memory::SystemMemoryManager;
use crate::services::credential_service;
use serde_json;

// ── Enums ──────────────────────────────────────────────────

/// Variants `Dm` and `TeamLeader` are matched in `resolve_tool_names` but
/// only constructed by frontend-driven paths (via tests). Keep them for
/// exhaustive match coverage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionRole {
    /// Single-agent (direct message) mode — resolved by frontend
    #[allow(dead_code)]
    Dm,
    /// Leader of a team run (user-initiated) — resolved by frontend
    #[allow(dead_code)]
    TeamLeader,
    /// Member executing a delegated task
    TeamMember,
    /// Leader synthesizing team member reports
    TeamLeaderSynthesis,
    /// Executing a scheduled (cron) task
    CronExecution,
    /// Responding to an incoming relay peer message
    RelayResponse,
}

/// `UserInitiated` is matched in `resolve_tool_names` but only constructed
/// by frontend-driven paths (via tests).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionTrigger {
    /// Initiated by a user message — resolved by frontend
    #[allow(dead_code)]
    UserInitiated,
    /// Initiated by backend orchestration (e.g. team leader delegating)
    BackendTriggered,
}

// ── ExecutionScope ─────────────────────────────────────────

/// Describes *who* is acting and *why*, before any DB lookups.
#[derive(Debug, Clone)]
pub struct ExecutionScope {
    pub actor_agent_id: String,
    pub role: ExecutionRole,
    pub trigger: ExecutionTrigger,
}

// ── ResolvedContext ────────────────────────────────────────

/// Fully resolved execution context ready for an LLM turn.
#[derive(Debug, Clone)]
pub struct ResolvedContext {
    pub system_prompt: String,
    pub enabled_tool_names: Vec<String>,
    pub model: String,
    pub temperature: Option<f64>,
    pub thinking_enabled: bool,
    pub thinking_budget: Option<i64>,
    /// Consolidated long-term memory for this agent (if available).
    pub consolidated_memory: Option<String>,
    /// Preformatted [REGISTERED AGENTS] section (manager agents only).
    pub registered_agents_section: Option<String>,
    /// Preformatted [SYSTEM CONTEXT] section with available tool names.
    pub tools_section: Option<String>,
    /// Preformatted [AVAILABLE CREDENTIALS] section with env var names.
    pub credentials_section: Option<String>,
}

// ── Default LLM settings ──────────────────────────────────

const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4-20250514";

// ── Orchestration tool names ──────────────────────────────

const TOOL_DELEGATE: &str = "delegate";
const TOOL_REPORT: &str = "report";

// ── resolve() ──────────────────────────────────────────────

/// Resolve an [`ExecutionScope`] into a [`ResolvedContext`] by loading the
/// agent from DB, assembling persona files, and filtering tools by role.
///
/// `memory_mgr` is optional for backward compatibility (tests may pass `None`).
/// Optional relay-specific allowed tools list (from relay-settings.json).
/// When `Some`, only these tools are permitted for `RelayResponse` role.
/// When `None` or empty, defaults to built-in read-only set.
pub fn resolve(
    scope: &ExecutionScope,
    db: &Database,
    app_data_dir: &std::path::Path,
    memory_mgr: Option<&SystemMemoryManager>,
) -> Result<ResolvedContext, AppError> {
    resolve_with_relay_tools(scope, db, app_data_dir, memory_mgr, None)
}

pub fn resolve_with_relay_tools(
    scope: &ExecutionScope,
    db: &Database,
    app_data_dir: &std::path::Path,
    memory_mgr: Option<&SystemMemoryManager>,
    relay_allowed_tools: Option<&[String]>,
) -> Result<ResolvedContext, AppError> {
    // 1. Load agent record
    let agent = agent_operations::get_agent_impl(db, scope.actor_agent_id.clone())?;

    // 2. Read persona files from the agent's folder
    let agent_dir = app_data_dir.join("agents").join(&agent.folder_name);
    let mut system_prompt = assemble_system_prompt(&agent_dir);

    // Strip {{company_name}} placeholders — the backend doesn't have access to
    // the frontend settings store. Removing the placeholder is safer than leaking
    // raw template syntax into the LLM prompt.
    if system_prompt.contains("{{company_name}}") {
        system_prompt = system_prompt.replace("{{company_name}}", "");
    }

    // 3. Determine enabled tools based on role + trigger + TOOL_CONFIG.json
    let enabled_tool_names = resolve_tool_names(&scope.role, &scope.trigger, &agent_dir, relay_allowed_tools);

    // 4. LLM settings — agent-level with global fallback
    let model = agent
        .model
        .clone()
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let temperature = agent.temperature;
    let thinking_enabled = agent.thinking_enabled.unwrap_or(false);
    let thinking_budget = agent.thinking_budget;

    // 5. Consolidated memory (if memory manager available)
    let consolidated_memory =
        memory_mgr.and_then(|mgr| mgr.read_consolidated(&scope.actor_agent_id));

    // 6. Manager agent context
    let registered_agents_section = if agent.is_default {
        build_registered_agents_section(db)
    } else {
        None
    };

    // 7. Tools section
    let tools_section = if !enabled_tool_names.is_empty() {
        Some(format!(
            "[SYSTEM CONTEXT]\nAvailable tools: {}",
            enabled_tool_names.join(", ")
        ))
    } else {
        None
    };

    // 8. Credentials section (only when run_shell is enabled and agent has credentials)
    let has_run_shell = enabled_tool_names.contains(&"run_shell".to_string());
    let has_browser_type = enabled_tool_names.contains(&"browser_type".to_string());
    let credentials_section = if has_run_shell || has_browser_type {
        build_credentials_section(&agent_dir, app_data_dir, has_run_shell, has_browser_type)
    } else {
        None
    };

    Ok(ResolvedContext {
        system_prompt,
        enabled_tool_names,
        model,
        temperature,
        thinking_enabled,
        thinking_budget,
        consolidated_memory,
        registered_agents_section,
        tools_section,
        credentials_section,
    })
}

/// Return the role-specific instruction string for backend execution paths.
pub fn role_instruction(role: &ExecutionRole) -> Option<&'static str> {
    match role {
        ExecutionRole::TeamMember => Some(
            "You are a team member executing a delegated task. \
             When you have completed your work, use the `report` tool to submit your findings.",
        ),
        ExecutionRole::TeamLeaderSynthesis => Some(
            "You are the team leader. Synthesize the reports from your team members \
             into a coherent, comprehensive response for the user.",
        ),
        ExecutionRole::CronExecution => Some(
            "You are executing a scheduled task. Complete the task described below \
             and provide a concise summary of your results.",
        ),
        ExecutionRole::RelayResponse => Some(
            "You are responding to a message from an external peer. \
             Read the conversation and respond naturally, as you would in a normal conversation with a user. \
             Use available tools when needed to fulfill requests.",
        ),
        _ => None,
    }
}

/// Build the [REGISTERED AGENTS] section for manager agents.
fn build_registered_agents_section(db: &Database) -> Option<String> {
    let agents = agent_operations::list_agents_impl(db).ok()?;
    let others: Vec<_> = agents.iter().filter(|a| !a.is_default).collect();
    if others.is_empty() {
        return Some("[REGISTERED AGENTS]\nNo registered agents.".to_string());
    }
    let list = others
        .iter()
        .map(|a| format!("- **{}**: {}", a.name, if a.description.is_empty() { "(no description)" } else { &a.description }))
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!("[REGISTERED AGENTS]\n{list}"))
}

// ── Persona assembly (best-effort) ────────────────────────

/// Read and concatenate persona markdown files from the agent's directory.
/// Missing files are silently skipped — this is intentional so that agents
/// work even before persona files are created.
///
/// Format matches the frontend `personaService.ts::assembleSystemPrompt`:
/// `[SECTION]\ncontent` separated by `\n\n---\n\n`.
fn assemble_system_prompt(agent_dir: &std::path::Path) -> String {
    let files = [
        ("IDENTITY", "IDENTITY.md"),
        ("SOUL", "SOUL.md"),
        ("USER", "USER.md"),
        ("AGENTS", "AGENTS.md"),
    ];
    let mut parts: Vec<String> = Vec::new();

    for (section, fname) in &files {
        let path = agent_dir.join(fname);
        if let Ok(content) = std::fs::read_to_string(&path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                parts.push(format!("[{section}]\n{trimmed}"));
            }
        }
    }

    parts.join("\n\n---\n\n")
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
    relay_allowed_tools: Option<&[String]>,
) -> Vec<String> {
    match role {
        // DM — full tool access; empty vec signals "use default frontend config"
        ExecutionRole::Dm => Vec::new(),

        // Cron execution — all enabled tools except browser/orchestration/shell.
        // Browser requires UI, orchestration requires team context,
        // and shell commands are blocked to prevent unattended persistent execution.
        ExecutionRole::CronExecution => {
            const CRON_BLOCKED_TOOLS: &[&str] = &["run_shell", "manage_schedule"];
            let config_tools = read_tool_config(agent_dir);
            config_tools
                .into_iter()
                .filter(|(name, _)| {
                    !name.starts_with("browser_")
                        && name != "delegate"
                        && name != "report"
                        && !CRON_BLOCKED_TOOLS.contains(&name.as_str())
                })
                .map(|(name, _)| name)
                .collect()
        }

        // Relay response — filter by user-configured allowed list.
        // If no custom list is set, defaults to read-only tools.
        ExecutionRole::RelayResponse => {
            // Tools that must NEVER be available in relay context regardless of user config
            const RELAY_BLOCKED_TOOLS: &[&str] = &["run_shell"];
            const DEFAULT_RELAY_ALLOWED: &[&str] = &[
                "read_file", "list_directory", "web_search",
                "self_inspect",
            ];
            let config_tools = read_tool_config(agent_dir);
            let allowed: Vec<&str> = match relay_allowed_tools {
                Some(list) if !list.is_empty() => list.iter().map(|s| s.as_str()).collect(),
                _ => DEFAULT_RELAY_ALLOWED.to_vec(),
            };
            config_tools
                .into_iter()
                .filter(|(name, _)| {
                    allowed.contains(&name.as_str())
                        && !RELAY_BLOCKED_TOOLS.contains(&name.as_str())
                })
                .map(|(name, _)| name)
                .collect()
        }

        // Team member — report only for v1.
        ExecutionRole::TeamMember => {
            vec![TOOL_REPORT.to_string()]
        }

        // Team leader synthesis — no tools needed (read-only synthesis)
        ExecutionRole::TeamLeaderSynthesis => Vec::new(),

        // Team leader (user-initiated or backend-triggered delegation)
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

// ── Credentials section ──────────────────────────────────

/// Build the [AVAILABLE CREDENTIALS] prompt section.
/// Reads TOOL_CONFIG.json for credential IDs, and credentials_meta.json for display names.
fn build_credentials_section(
    agent_dir: &std::path::Path,
    app_data_dir: &std::path::Path,
    has_run_shell: bool,
    has_browser_type: bool,
) -> Option<String> {
    let allowed = credential_service::read_allowed_credentials_from_dir(agent_dir).ok()?;
    if allowed.is_empty() {
        return None;
    }

    // Load display names from credentials metadata
    let meta_path = app_data_dir.join("credentials_meta.json");
    let metas: Vec<credential_service::CredentialMeta> = std::fs::read_to_string(&meta_path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default();

    // Validate which IDs are safe for browser placeholder syntax
    let is_valid_browser_id = |id: &str| -> bool {
        !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };

    let mut lines = Vec::new();
    for id in &allowed {
        let display_name = metas
            .iter()
            .find(|m| m.id == *id)
            .map(|m| m.name.as_str())
            .unwrap_or(id.as_str());

        let env_var = if has_run_shell {
            let env_name = credential_service::credential_id_to_env_var(id);
            if cfg!(target_os = "windows") {
                Some(format!("%{}%", env_name))
            } else {
                Some(format!("${}", env_name))
            }
        } else {
            None
        };

        let browser_placeholder = if has_browser_type && is_valid_browser_id(id) {
            Some(format!("{{{{credential:{}}}}}", id))
        } else {
            None
        };

        let usage: Vec<String> = [env_var, browser_placeholder]
            .into_iter()
            .flatten()
            .collect();

        if !usage.is_empty() {
            lines.push(format!("- {} ({}): {}", id, display_name, usage.join(", ")));
        }
    }
    lines.sort();

    let mut instructions = Vec::new();
    if has_run_shell {
        instructions.push("Use env vars in shell commands via run_shell.");
    }
    if has_browser_type {
        instructions.push("Use {{credential:ID}} in browser_type text parameter for password/login fields.");
    }
    instructions.push("Never echo, print, or expose credential values directly.");

    Some(format!(
        "[AVAILABLE CREDENTIALS]\n\
         The following credentials are available:\n\
         {}\n\
         {}",
        lines.join("\n"),
        instructions.join(" "),
    ))
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
            role: ExecutionRole::Dm,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let ctx = resolve(&scope, &db, tmp.path(), None).unwrap();

        assert_eq!(ctx.model, "gpt-4o");
        assert_eq!(ctx.temperature, Some(0.7));
        assert!(ctx.thinking_enabled);
        assert_eq!(ctx.thinking_budget, Some(8000));
        assert!(ctx.system_prompt.contains("[IDENTITY]"));
        assert!(ctx.system_prompt.contains("You are a test agent."));
        assert!(ctx.system_prompt.contains("[SOUL]"));
        assert!(ctx.system_prompt.contains("Be helpful."));
        // DM mode returns empty tool list (frontend provides)
        assert!(ctx.enabled_tool_names.is_empty());
        assert!(ctx.consolidated_memory.is_none());
    }

    #[test]
    fn test_resolve_team_member() {
        let (db, tmp, agent_id) = setup();
        let scope = ExecutionScope {
            actor_agent_id: agent_id,
            role: ExecutionRole::TeamMember,
            trigger: ExecutionTrigger::BackendTriggered,
        };

        let ctx = resolve(&scope, &db, tmp.path(), None).unwrap();

        // v1: TeamMember only gets "report" — no auto-tier tools yet
        assert_eq!(ctx.enabled_tool_names, vec!["report".to_string()]);
    }

    #[test]
    fn test_resolve_team_leader_user_initiated() {
        let (db, tmp, agent_id) = setup();
        let scope = ExecutionScope {
            actor_agent_id: agent_id,
            role: ExecutionRole::TeamLeader,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let ctx = resolve(&scope, &db, tmp.path(), None).unwrap();

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
            role: ExecutionRole::TeamLeader,
            trigger: ExecutionTrigger::BackendTriggered,
        };

        let ctx = resolve(&scope, &db, tmp.path(), None).unwrap();

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
            role: ExecutionRole::Dm,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let ctx = resolve(&scope, &db, tmp.path(), None).unwrap();

        // No persona files → empty prompt, but no error
        assert!(ctx.system_prompt.is_empty());
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
            role: ExecutionRole::Dm,
            trigger: ExecutionTrigger::UserInitiated,
        };

        let result = resolve(&scope, &db, tmp.path(), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_cron_blocks_run_shell_and_manage_schedule() {
        let db = Database::new_in_memory().expect("in-memory db");
        let tmp = TempDir::new().expect("tempdir");

        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                folder_name: "cron-agent".into(),
                name: "Cron Agent".into(),
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

        let agent_dir = tmp.path().join("agents").join("cron-agent");
        fs::create_dir_all(&agent_dir).unwrap();

        let tool_config = serde_json::json!({
            "version": 2,
            "auto_approve": false,
            "native": {
                "read_file": { "enabled": true, "tier": "auto" },
                "write_file": { "enabled": true, "tier": "confirm" },
                "run_shell": { "enabled": true, "tier": "confirm" },
                "manage_schedule": { "enabled": true, "tier": "confirm" },
                "browser_navigate": { "enabled": true, "tier": "confirm" },
                "self_inspect": { "enabled": true, "tier": "auto" },
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

        let scope = ExecutionScope {
            actor_agent_id: agent.id,
            role: ExecutionRole::CronExecution,
            trigger: ExecutionTrigger::BackendTriggered,
        };

        let ctx = resolve(&scope, &db, tmp.path(), None).unwrap();

        // Cron should include safe tools
        assert!(ctx.enabled_tool_names.contains(&"read_file".to_string()));
        assert!(ctx.enabled_tool_names.contains(&"write_file".to_string()));
        assert!(ctx.enabled_tool_names.contains(&"self_inspect".to_string()));
        // Cron should block run_shell and manage_schedule
        assert!(!ctx.enabled_tool_names.contains(&"run_shell".to_string()));
        assert!(!ctx.enabled_tool_names.contains(&"manage_schedule".to_string()));
        // Cron should also block browser and orchestration tools
        assert!(!ctx.enabled_tool_names.contains(&"browser_navigate".to_string()));
        assert!(!ctx.enabled_tool_names.contains(&"delegate".to_string()));
        assert!(!ctx.enabled_tool_names.contains(&"report".to_string()));
    }
}
