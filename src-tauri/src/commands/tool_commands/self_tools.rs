use crate::db::agent_operations;
use crate::db::cron_operations;
use crate::db::models::{CreateCronJobRequest, CronScheduleType, UpdateCronJobRequest};
use crate::db::{operations, Database};
use crate::services::cron_scheduler::CronScheduler;
use crate::utils::path_security::validate_no_traversal;
use tauri::{AppHandle, Manager};

use crate::utils::config_helpers::agents_dir;

// ── Self-awareness tools ──

/// Resolve the agent that owns a conversation. Returns (agent_id, Agent).
/// The agent_id is always derived server-side from the conversation — never from LLM input.
pub(super) fn resolve_agent_for_conversation(
    db: &Database,
    conversation_id: &str,
) -> Result<(String, crate::db::models::Agent), String> {
    let conv = operations::get_conversation_detail_impl(db, conversation_id.to_string())
        .map_err(|e| format!("Failed to get conversation: {}", e))?;
    let agent = agent_operations::get_agent_impl(db, conv.agent_id.clone())
        .map_err(|e| format!("Failed to get agent: {}", e))?;
    Ok((conv.agent_id, agent))
}

pub(super) fn tool_self_inspect(
    app: &AppHandle,
    db: &Database,
    agent_id_or_conv: &str,
) -> Result<serde_json::Value, String> {
    // Try as conversation_id first, fall back to direct agent_id
    let (agent_id, agent) =
        resolve_agent_for_conversation(db, agent_id_or_conv).or_else(|_| {
            let agent = agent_operations::get_agent_impl(db, agent_id_or_conv.to_string())
                .map_err(|e| format!("Failed to get agent: {e}"))?;
            Ok::<_, String>((agent_id_or_conv.to_string(), agent))
        })?;

    // Read enabled tools from TOOL_CONFIG.json
    validate_no_traversal(&agent.folder_name, "folder_name")?;
    let agents_dir = agents_dir(app)?;
    let config_path = agents_dir.join(&agent.folder_name).join("TOOL_CONFIG.json");
    let enabled_tools: Vec<String> = if let Ok(raw) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(native) = config.get("native").and_then(|v| v.as_object()) {
                native
                    .iter()
                    .filter(|(_, v)| {
                        v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false)
                    })
                    .map(|(k, _)| k.clone())
                    .collect()
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    // Get scheduled jobs for this agent
    let schedules = cron_operations::list_cron_jobs_for_agent_impl(db, &agent_id)
        .map_err(|e| format!("Failed to list cron jobs: {}", e))?;
    let schedules_json: Vec<serde_json::Value> = schedules
        .iter()
        .map(|j| {
            serde_json::json!({
                "id": j.id,
                "name": j.name,
                "description": j.description,
                "schedule_type": j.schedule_type,
                "schedule_value": j.schedule_value,
                "prompt": j.prompt,
                "enabled": j.enabled,
                "next_run_at": j.next_run_at,
                "last_run_at": j.last_run_at,
                "run_count": j.run_count,
            })
        })
        .collect();

    // System environment info — helps the agent know which OS/shell it runs on
    let os = std::env::consts::OS; // "linux", "windows", "macos"
    let arch = std::env::consts::ARCH; // "x86_64", "aarch64", etc.
    let shell_info = super::shell_tools::get_shell_info();

    Ok(serde_json::json!({
        "agent_id": agent_id,
        "name": agent.name,
        "description": agent.description,
        "model": agent.model,
        "temperature": agent.temperature,
        "thinking_enabled": agent.thinking_enabled,
        "thinking_budget": agent.thinking_budget,
        "enabled_tools": enabled_tools,
        "schedules": schedules_json,
        "system": {
            "os": os,
            "arch": arch,
            "shell": shell_info.program,
            "shell_type": if shell_info.is_posix { "posix" } else { "cmd" },
            "ssh_hardening": true,
        },
    }))
}

pub(super) fn tool_manage_schedule(
    app: &AppHandle,
    db: &Database,
    input: &serde_json::Value,
    agent_id_or_conv: &str,
) -> Result<serde_json::Value, String> {
    // Try as conversation_id first, fall back to direct agent_id
    let (agent_id, _agent) =
        resolve_agent_for_conversation(db, agent_id_or_conv).or_else(|_| {
            let agent = agent_operations::get_agent_impl(db, agent_id_or_conv.to_string())
                .map_err(|e| format!("Failed to get agent: {e}"))?;
            Ok::<_, String>((agent_id_or_conv.to_string(), agent))
        })?;

    let action = input
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or("manage_schedule: missing 'action' parameter")?;

    match action {
        "list" => {
            let jobs = cron_operations::list_cron_jobs_for_agent_impl(db, &agent_id)
                .map_err(|e| format!("Failed to list cron jobs: {}", e))?;
            let jobs_json: Vec<serde_json::Value> = jobs
                .iter()
                .map(|j| {
                    serde_json::json!({
                        "id": j.id,
                        "name": j.name,
                        "description": j.description,
                        "schedule_type": j.schedule_type,
                        "schedule_value": j.schedule_value,
                        "prompt": j.prompt,
                        "enabled": j.enabled,
                        "next_run_at": j.next_run_at,
                        "last_run_at": j.last_run_at,
                        "run_count": j.run_count,
                    })
                })
                .collect();
            Ok(serde_json::json!({ "jobs": jobs_json }))
        }
        "create" => {
            let name = input
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'name'")?;
            let schedule_type_str = input
                .get("schedule_type")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'schedule_type'")?;
            let schedule_type: CronScheduleType = schedule_type_str.parse().map_err(|_| {
                format!(
                    "Invalid schedule_type: '{}'. Must be at/every/cron",
                    schedule_type_str
                )
            })?;
            let schedule_value = input
                .get("schedule_value")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'schedule_value'")?;
            let prompt = input
                .get("prompt")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule create: missing 'prompt'")?;
            let description = input
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let enabled = input.get("enabled").and_then(|v| v.as_bool());

            let request = CreateCronJobRequest {
                agent_id: agent_id.clone(),
                name: name.to_string(),
                description,
                schedule_type,
                schedule_value: schedule_value.to_string(),
                prompt: prompt.to_string(),
                enabled,
            };

            let job = cron_operations::create_cron_job_impl(db, request)
                .map_err(|e| format!("Failed to create cron job: {}", e))?;

            // Notify scheduler of the change
            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({
                "success": true,
                "job": {
                    "id": job.id,
                    "name": job.name,
                    "schedule_type": job.schedule_type,
                    "schedule_value": job.schedule_value,
                    "enabled": job.enabled,
                    "next_run_at": job.next_run_at,
                }
            }))
        }
        "update" => {
            let job_id = input
                .get("job_id")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule update: missing 'job_id'")?;

            // Ownership check
            let existing = cron_operations::get_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to get cron job: {}", e))?;
            if existing.agent_id != agent_id {
                return Err(
                    "Permission denied: this cron job belongs to another agent".to_string(),
                );
            }

            let schedule_type: Option<CronScheduleType> = input
                .get("schedule_type")
                .and_then(|v| v.as_str())
                .map(|s| {
                    s.parse()
                        .map_err(|_| format!("Invalid schedule_type: '{}'", s))
                })
                .transpose()?;

            let request = UpdateCronJobRequest {
                name: input
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                description: input
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                schedule_type,
                schedule_value: input
                    .get("schedule_value")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                prompt: input
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                enabled: input.get("enabled").and_then(|v| v.as_bool()),
            };

            let job = cron_operations::update_cron_job_impl(db, job_id, request)
                .map_err(|e| format!("Failed to update cron job: {}", e))?;

            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({
                "success": true,
                "job": {
                    "id": job.id,
                    "name": job.name,
                    "schedule_type": job.schedule_type,
                    "schedule_value": job.schedule_value,
                    "enabled": job.enabled,
                    "next_run_at": job.next_run_at,
                }
            }))
        }
        "delete" => {
            let job_id = input
                .get("job_id")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule delete: missing 'job_id'")?;

            // Ownership check
            let existing = cron_operations::get_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to get cron job: {}", e))?;
            if existing.agent_id != agent_id {
                return Err(
                    "Permission denied: this cron job belongs to another agent".to_string(),
                );
            }

            cron_operations::delete_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to delete cron job: {}", e))?;

            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({ "success": true, "deleted_job_id": job_id }))
        }
        "toggle" => {
            let job_id = input
                .get("job_id")
                .and_then(|v| v.as_str())
                .ok_or("manage_schedule toggle: missing 'job_id'")?;
            let enabled = input
                .get("enabled")
                .and_then(|v| v.as_bool())
                .ok_or("manage_schedule toggle: missing 'enabled'")?;

            // Ownership check
            let existing = cron_operations::get_cron_job_impl(db, job_id)
                .map_err(|e| format!("Failed to get cron job: {}", e))?;
            if existing.agent_id != agent_id {
                return Err(
                    "Permission denied: this cron job belongs to another agent".to_string(),
                );
            }

            let job = cron_operations::toggle_cron_job_impl(db, job_id, enabled)
                .map_err(|e| format!("Failed to toggle cron job: {}", e))?;

            app.state::<CronScheduler>().notify_change();

            Ok(serde_json::json!({
                "success": true,
                "job": {
                    "id": job.id,
                    "name": job.name,
                    "enabled": job.enabled,
                    "next_run_at": job.next_run_at,
                }
            }))
        }
        _ => Err(format!(
            "manage_schedule: unknown action '{}'. Must be one of: list, create, update, delete, toggle",
            action
        )),
    }
}
