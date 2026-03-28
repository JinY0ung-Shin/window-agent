//! Team synthesis: report aggregation and leader LLM synthesis.
//!
//! Extracted from `team_orchestrator.rs` to isolate the logic that collects
//! reports from completed tasks and generates a synthesis via the leader LLM.

use crate::api::{ApiState, RunRegistry};
use crate::db::models::{TaskStatus, TeamRunStatus};
use crate::db::team_operations;
use crate::db::Database;
use crate::memory::SystemMemoryManager;
use crate::services::actor_context::{self, ExecutionRole, ExecutionScope, ExecutionTrigger};
use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// ── Synthesis-specific payloads ───────────────────────────

#[derive(Serialize, Clone)]
pub struct TeamAllReportsPayload {
    pub run_id: String,
    pub reports: Vec<TaskReport>,
}

#[derive(Serialize, Clone)]
pub struct TaskReport {
    pub task_id: String,
    pub agent_id: String,
    pub summary: String,
    pub details: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TeamSynthesisDonePayload {
    pub run_id: String,
    pub request_id: String,
    pub error: Option<String>,
}

// ── Synthesis logic ───────────────────────────────────────

/// Check if all tasks for a run are done, and if so, trigger leader synthesis.
///
/// Returns `true` if all tasks are done and synthesis has been started.
pub async fn check_and_synthesize(
    app: &AppHandle,
    db: &Database,
    run_id: &str,
) -> Result<bool, String> {
    // Check if all tasks for this run are done
    let all_tasks = team_operations::get_team_tasks_impl(db, run_id)
        .map_err(|e| format!("Failed to get tasks: {e}"))?;

    let all_done = all_tasks.iter().all(|t| {
        matches!(
            t.status,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled
        )
    });

    if !all_done {
        return Ok(false); // still waiting for more reports
    }

    // Update run status to synthesizing
    let _ = team_operations::update_team_run_status_impl(
        db,
        run_id,
        TeamRunStatus::Synthesizing,
        None,
    );

    // Assemble all reports
    let reports: Vec<TaskReport> = all_tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Completed)
        .map(|t| TaskReport {
            task_id: t.id.clone(),
            agent_id: t.agent_id.clone(),
            summary: t.result_summary.clone().unwrap_or_default(),
            details: None,
        })
        .collect();

    // Trigger backend leader synthesis
    let run = team_operations::get_team_run_impl(db, run_id)
        .map_err(|e| format!("Failed to get run: {e}"))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let leader_scope = ExecutionScope {
        actor_agent_id: run.leader_agent_id.clone(),
        role: ExecutionRole::TeamLeaderSynthesis,
        trigger: ExecutionTrigger::BackendTriggered,
    };

    let memory_mgr = app.state::<SystemMemoryManager>();
    let leader_ctx = actor_context::resolve_for_conversation(
        &leader_scope, db, &app_data_dir, Some(&*memory_mgr), Some(&run.conversation_id),
    )
    .map_err(|e| format!("Failed to resolve leader context: {e}"))?;

    // Build reports text for synthesis prompt (before moving reports into emit)
    let mut reports_text = String::from("## Team Member Reports\n\n");
    for report in &reports {
        reports_text.push_str(&format!(
            "### Agent {}\n{}\n\n",
            report.agent_id, report.summary
        ));
    }

    // Emit reports-in event (informational for frontend)
    let _ = app.emit(
        "team-all-reports-in",
        TeamAllReportsPayload {
            run_id: run_id.to_string(),
            reports,
        },
    );

    // Build leader system prompt
    let mut system_parts = Vec::new();
    if !leader_ctx.system_prompt.is_empty() {
        system_parts.push(leader_ctx.system_prompt.clone());
    }
    if let Some(ref agents_sec) = leader_ctx.registered_agents_section {
        system_parts.push(agents_sec.clone());
    }
    if leader_ctx.learning_mode {
        system_parts.push(super::llm_helpers::LEARNING_MODE_PROMPT.to_string());
    }
    if let Some(ref mem) = leader_ctx.consolidated_memory {
        system_parts.push(format!("[CONSOLIDATED MEMORY]\n{mem}"));
    }
    system_parts.push(
        actor_context::role_instruction(&leader_scope.role)
            .unwrap_or("Synthesize the reports into a coherent response.")
            .to_string(),
    );
    let system_prompt = system_parts.join("\n\n");

    let mut body = serde_json::json!({
        "model": leader_ctx.model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": reports_text },
        ],
        "stream": true,
    });

    if let Some(temp) = leader_ctx.temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if leader_ctx.thinking_enabled {
        if let Some(budget) = leader_ctx.thinking_budget {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget,
            });
        }
    }

    // Spawn synthesis task
    let synthesis_request_id = format!("synthesis-{}", run_id);
    let app_clone = app.clone();
    let run_id_owned = run_id.to_string();

    let api_state = app.state::<ApiState>();
    let (api_key, base_url) = api_state
        .effective()
        .map_err(|e| format!("API state error: {e}"))?;
    let client = api_state
        .client()
        .map_err(|e| format!("API client error: {e}"))?;
    let registry = app.state::<RunRegistry>();
    let registry_clone: RunRegistry = (*registry).clone();

    let req_id_for_spawn = synthesis_request_id.clone();

    let join_handle = tokio::spawn(async move {
        let result = crate::services::api_service::stream_completion(
            &app_clone,
            &client,
            &api_key,
            &base_url,
            &body,
            &req_id_for_spawn,
        )
        .await;

        // Clean up from registry
        registry_clone.remove(&req_id_for_spawn).await;

        let db_ref = app_clone.state::<Database>();

        let error = match &result {
            Ok(()) => None,
            Err(e) => Some(e.to_string()),
        };

        // Update run status to completed (or failed)
        let final_status = if result.is_ok() {
            TeamRunStatus::Completed
        } else {
            TeamRunStatus::Failed
        };
        let _ = team_operations::update_team_run_status_impl(
            &db_ref,
            &run_id_owned,
            final_status,
            Some(Utc::now().to_rfc3339()),
        );

        // Emit synthesis done event (move values — no clones needed)
        let _ = app_clone.emit(
            "team-leader-synthesis-done",
            TeamSynthesisDonePayload {
                run_id: run_id_owned,
                request_id: req_id_for_spawn,
                error,
            },
        );
    });

    // Register for abort support
    registry
        .register(synthesis_request_id, join_handle.abort_handle())
        .await;

    Ok(true) // all done, synthesis started
}
