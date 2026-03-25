//! Team task spawning and event payloads.
//!
//! Extracted from `team_orchestrator.rs` to isolate the logic that creates DB tasks
//! and spawns parallel tokio tasks for agent LLM streams.

use crate::api::{ApiState, RunRegistry};
use crate::commands::tool_commands::native_tool_definitions;
use crate::db::models::TaskStatus;
use crate::db::team_operations;
use crate::db::Database;
use crate::memory::SystemMemoryManager;
use crate::services::actor_context::{self, ExecutionRole, ExecutionScope, ExecutionTrigger};
use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// ── Team-specific event payloads ──────────────────────────

#[derive(Serialize, Clone)]
pub struct TeamStreamDonePayload {
    pub run_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub content: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TeamRunCancelledPayload {
    pub run_id: String,
}

// ── Task spawning ─────────────────────────────────────────

/// Create DB tasks for each agent and spawn parallel LLM streams.
/// Returns the list of created task IDs.
pub async fn spawn_agent_tasks(
    app: &AppHandle,
    db: &Database,
    run_id: &str,
    agent_ids: &[String],
    task: &str,
    context: Option<&str>,
) -> Result<Vec<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let mut task_ids = Vec::new();

    for agent_id in agent_ids {
        // 1. Create a team_task (status: queued)
        let team_task = team_operations::create_team_task_impl(
            db,
            run_id.to_string(),
            agent_id.clone(),
            task.to_string(),
            None,
        )
        .map_err(|e| format!("Failed to create team task: {e}"))?;

        task_ids.push(team_task.id.clone());

        // 2. Build ExecutionScope for this member
        let scope = ExecutionScope {
            actor_agent_id: agent_id.clone(),
            role: ExecutionRole::TeamMember,
            trigger: ExecutionTrigger::BackendTriggered,
        };

        // 3. Resolve context via ActorExecutionContext
        let memory_mgr = app.state::<SystemMemoryManager>();
        let resolved = actor_context::resolve(&scope, db, &app_data_dir, Some(&*memory_mgr))
            .map_err(|e| format!("Failed to resolve context for agent {agent_id}: {e}"))?;

        // 4. Update task status to running
        let _ = team_operations::update_team_task_impl(
            db,
            &team_task.id,
            Some(TaskStatus::Running),
            None,
            None,
            None,
        );

        // 5. Build the LLM request body
        let mut system_parts = Vec::new();
        if !resolved.system_prompt.is_empty() {
            system_parts.push(resolved.system_prompt.clone());
        }
        if let Some(ref agents_sec) = resolved.registered_agents_section {
            system_parts.push(agents_sec.clone());
        }
        if let Some(ref tools_sec) = resolved.tools_section {
            system_parts.push(tools_sec.clone());
        }
        if let Some(ref mem) = resolved.consolidated_memory {
            system_parts.push(format!("[CONSOLIDATED MEMORY]\n{mem}"));
        }
        system_parts.push(format!(
            "{}\nYour task: {task}",
            actor_context::role_instruction(&scope.role).unwrap_or_default()
        ));
        if let Some(ctx) = context {
            system_parts.push(format!("Context from leader:\n{ctx}"));
        }

        let system_prompt = system_parts.join("\n\n");

        let messages = vec![serde_json::json!({
            "role": "user",
            "content": task,
        })];

        // Build tools array from resolved enabled_tool_names using native definitions
        let all_defs = native_tool_definitions();
        let tools: Vec<serde_json::Value> = resolved
            .enabled_tool_names
            .iter()
            .filter_map(|name| {
                all_defs.iter().find(|d| d.name == *name).map(|def| {
                    serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": def.name,
                            "description": def.description,
                            "parameters": def.parameters,
                        }
                    })
                })
            })
            .collect();

        let mut body = serde_json::json!({
            "model": resolved.model,
            "messages": [
                { "role": "system", "content": system_prompt },
            ],
            "stream": true,
            "tools": tools,
        });

        // Append user messages
        if let Some(msgs) = body["messages"].as_array_mut() {
            for msg in &messages {
                msgs.push(msg.clone());
            }
        }

        if let Some(temp) = resolved.temperature {
            body["temperature"] = serde_json::json!(temp);
        }

        if resolved.thinking_enabled {
            if let Some(budget) = resolved.thinking_budget {
                body["thinking"] = serde_json::json!({
                    "type": "enabled",
                    "budget_tokens": budget,
                });
            }
        }

        // 6. Spawn tokio task for parallel LLM call
        let app_clone = app.clone();
        let run_id_clone = run_id.to_string();
        let task_id_clone = team_task.id.clone();
        let agent_id_clone = agent_id.clone();

        let api_state = app.state::<ApiState>();
        let (api_key, base_url) = api_state
            .effective()
            .map_err(|e| format!("API state error: {e}"))?;
        let client = api_state
            .client()
            .map_err(|e| format!("API client error: {e}"))?;
        let registry = app.state::<RunRegistry>();
        let registry_clone: RunRegistry = (*registry).clone();

        // Generate a request_id for this agent's stream
        let request_id = format!("team-{}-{}", run_id, team_task.id);

        // Store request_id in the task
        let _ = team_operations::update_team_task_impl(
            db,
            &team_task.id,
            None,
            Some(request_id.clone()),
            None,
            None,
        );

        let join_handle = tokio::spawn(async move {
            let result = crate::services::api_service::stream_completion(
                &app_clone,
                &client,
                &api_key,
                &base_url,
                &body,
                &request_id,
            )
            .await;

            // Clean up from registry
            registry_clone.remove(&request_id).await;

            // Get DB from managed state for updates inside spawned task
            let db_ref = app_clone.state::<Database>();

            match result {
                Ok(()) => {
                    // The stream_completion emits chat-stream-done with the request_id.
                    // We also emit a team-specific event so the frontend can track per-agent.
                    let _ = app_clone.emit(
                        "team-agent-stream-done",
                        TeamStreamDonePayload {
                            run_id: run_id_clone.clone(),
                            task_id: task_id_clone.clone(),
                            agent_id: agent_id_clone.clone(),
                            content: String::new(), // Content is in the stream-done event
                            error: None,
                        },
                    );
                }
                Err(e) => {
                    let error_msg = e.to_string();

                    // Update task as failed
                    let _ = team_operations::update_team_task_impl(
                        &db_ref,
                        &task_id_clone,
                        Some(TaskStatus::Failed),
                        None,
                        Some(format!("LLM error: {error_msg}")),
                        Some(Utc::now().to_rfc3339()),
                    );

                    let _ = app_clone.emit(
                        "team-agent-stream-done",
                        TeamStreamDonePayload {
                            run_id: run_id_clone,
                            task_id: task_id_clone,
                            agent_id: agent_id_clone,
                            content: String::new(),
                            error: Some(error_msg),
                        },
                    );
                }
            }
        });

        // Register in RunRegistry for abort support
        registry
            .register(
                format!("team-{}-{}", run_id, team_task.id),
                join_handle.abort_handle(),
            )
            .await;
    }

    Ok(task_ids)
}
