use crate::api::{ApiState, RunRegistry};
use crate::commands::tool_commands::native_tool_definitions;
use crate::db::models::{TaskStatus, TeamRunStatus};
use crate::db::team_operations;
use crate::db::Database;
use crate::services::actor_context::{self, ExecutionRole, ExecutionScope, ExecutionTrigger};
use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// ── Team-specific event payloads ──────────────────────────

#[derive(Serialize, Clone)]
#[allow(dead_code)] // TODO: emit via Tauri event for real-time team task streaming
pub struct TeamStreamChunkPayload {
    pub run_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub delta: String,
    pub reasoning_delta: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TeamStreamDonePayload {
    pub run_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub content: String,
    pub error: Option<String>,
}

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
pub struct TeamRunCancelledPayload {
    pub run_id: String,
}

#[derive(Serialize, Clone)]
pub struct TeamSynthesisDonePayload {
    pub run_id: String,
    pub request_id: String,
    pub error: Option<String>,
}

// ── TeamOrchestrator ──────────────────────────────────────

pub struct TeamOrchestrator;

impl TeamOrchestrator {
    /// Execute delegation: create tasks for each agent and spawn parallel LLM streams.
    pub async fn execute_delegation(
        app: &AppHandle,
        db: &Database,
        conversation_id: &str,
        run_id: &str,
        agent_ids: Vec<String>,
        task: String,
        context: Option<String>,
    ) -> Result<Vec<String>, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

        let mut task_ids = Vec::new();

        for agent_id in &agent_ids {
            // 1. Create a team_task (status: queued)
            let team_task = team_operations::create_team_task_impl(
                db,
                run_id.to_string(),
                agent_id.clone(),
                task.clone(),
                None,
            )
            .map_err(|e| format!("Failed to create team task: {e}"))?;

            task_ids.push(team_task.id.clone());

            // 2. Build ExecutionScope for this member
            let scope = ExecutionScope {
                actor_agent_id: agent_id.clone(),
                conversation_id: conversation_id.to_string(),
                team_id: None, // Will be populated when we have team_id in context
                team_run_id: Some(run_id.to_string()),
                team_task_id: Some(team_task.id.clone()),
                role: ExecutionRole::TeamMember,
                trigger: ExecutionTrigger::BackendTriggered,
            };

            // 3. Resolve context via ActorExecutionContext
            let resolved = actor_context::resolve(&scope, db, &app_data_dir)
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
            system_parts.push(format!(
                "You are a team member executing a delegated task. \
                 When you have completed your work, use the `report` tool to submit your findings.\n\
                 Your task: {task}"
            ));
            if let Some(ref ctx) = context {
                system_parts.push(format!("Context from leader:\n{ctx}"));
            }

            let system_prompt = system_parts.join("\n\n");

            let messages = vec![serde_json::json!({
                "role": "user",
                "content": task.clone(),
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
            let (api_key, base_url) = api_state.effective()
                .map_err(|e| format!("API state error: {e}"))?;
            let client = api_state.client()
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

        // Update run status to waiting_reports
        let _ = team_operations::update_team_run_status_impl(
            db,
            run_id,
            TeamRunStatus::WaitingReports,
            None,
        );

        Ok(task_ids)
    }

    /// Handle a report from a team member.
    pub async fn handle_report(
        app: &AppHandle,
        db: &Database,
        run_id: &str,
        task_id: &str,
        summary: String,
        details: Option<String>,
    ) -> Result<bool, String> {
        // 1. Update team_task → done, save result_summary
        let result_text = match &details {
            Some(d) => format!("{summary}\n\n{d}"),
            None => summary.clone(),
        };

        team_operations::update_team_task_impl(
            db,
            task_id,
            Some(TaskStatus::Completed),
            None,
            Some(result_text),
            Some(Utc::now().to_rfc3339()),
        )
        .map_err(|e| format!("Failed to update task: {e}"))?;

        // 2. Check if all tasks for this run are done
        let all_tasks = team_operations::get_team_tasks_impl(db, run_id)
            .map_err(|e| format!("Failed to get tasks: {e}"))?;

        let all_done = all_tasks
            .iter()
            .all(|t| matches!(t.status, TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled));

        if all_done {
            // 3. Update run status to synthesizing
            let _ = team_operations::update_team_run_status_impl(
                db,
                run_id,
                TeamRunStatus::Synthesizing,
                None,
            );

            // 4. Assemble all reports
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

            // 5. Trigger backend leader synthesis
            let run = team_operations::get_team_run_impl(db, run_id)
                .map_err(|e| format!("Failed to get run: {e}"))?;

            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

            let leader_scope = ExecutionScope {
                actor_agent_id: run.leader_agent_id.clone(),
                conversation_id: run.conversation_id.clone(),
                team_id: Some(run.team_id.clone()),
                team_run_id: Some(run_id.to_string()),
                team_task_id: None,
                role: ExecutionRole::TeamLeader,
                trigger: ExecutionTrigger::BackendTriggered,
            };

            let leader_ctx = actor_context::resolve(&leader_scope, db, &app_data_dir)
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
            system_parts.push(
                "You are the team leader. Synthesize the reports from your team members \
                 into a coherent, comprehensive response for the user."
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
            let (api_key, base_url) = api_state.effective()
                .map_err(|e| format!("API state error: {e}"))?;
            let client = api_state.client()
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

            return Ok(true); // all done, synthesis started
        }

        Ok(false) // still waiting for more reports
    }

    /// Abort an entire team run.
    pub async fn abort_team_run(
        app: &AppHandle,
        db: &Database,
        run_registry: &RunRegistry,
        run_id: &str,
    ) -> Result<(), String> {
        // 1. Get all tasks for this run
        let tasks = team_operations::get_team_tasks_impl(db, run_id)
            .map_err(|e| format!("Failed to get tasks: {e}"))?;

        // 2. For each running/queued task: abort via RunRegistry if request_id exists
        for task in &tasks {
            if matches!(task.status, TaskStatus::Running | TaskStatus::Queued) {
                if let Some(ref request_id) = task.request_id {
                    run_registry.abort(request_id).await;
                }

                // 3. Update task status → cancelled
                let _ = team_operations::update_team_task_impl(
                    db,
                    &task.id,
                    Some(TaskStatus::Cancelled),
                    None,
                    None,
                    Some(Utc::now().to_rfc3339()),
                );
            }
        }

        // 4. Update run status → cancelled
        let _ = team_operations::update_team_run_status_impl(
            db,
            run_id,
            TeamRunStatus::Cancelled,
            Some(Utc::now().to_rfc3339()),
        );

        // 5. Emit team-run-cancelled event
        let _ = app.emit(
            "team-run-cancelled",
            TeamRunCancelledPayload {
                run_id: run_id.to_string(),
            },
        );

        Ok(())
    }

    /// Recover runs on app startup (mark stale running runs as failed).
    pub fn recover_runs(db: &Database) -> Result<u32, String> {
        let running_runs = team_operations::get_running_runs_impl(db)
            .map_err(|e| format!("Failed to get running runs: {e}"))?;

        let now = Utc::now().to_rfc3339();
        let mut recovered = 0u32;

        for run in &running_runs {
            // Mark all tasks for this run as failed
            if let Ok(tasks) = team_operations::get_team_tasks_impl(db, &run.id) {
                for task in &tasks {
                    if matches!(task.status, TaskStatus::Running | TaskStatus::Queued) {
                        let _ = team_operations::update_team_task_impl(
                            db,
                            &task.id,
                            Some(TaskStatus::Failed),
                            None,
                            Some("Recovered on startup — previous run interrupted".to_string()),
                            Some(now.clone()),
                        );
                    }
                }
            }

            // Mark run as failed
            let _ = team_operations::update_team_run_status_impl(
                db,
                &run.id,
                TeamRunStatus::Failed,
                Some(now.clone()),
            );
            recovered += 1;
        }

        Ok(recovered)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::agent_operations::create_agent_impl;
    use crate::db::models::CreateAgentRequest;
    use crate::db::operations::create_conversation_impl;
    use crate::db::team_operations::*;
    use crate::db::Database;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn create_test_agent(db: &Database, folder: &str, name: &str) -> String {
        let agent = create_agent_impl(
            db,
            CreateAgentRequest {
                folder_name: folder.into(),
                name: name.into(),
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
        .unwrap();
        agent.id
    }

    #[test]
    fn test_recover_runs_marks_stale_as_failed() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let member_id = create_test_agent(&db, "member", "Member");

        let team = create_team_impl(
            &db,
            crate::db::models::CreateTeamRequest {
                name: "Test Team".into(),
                description: None,
                leader_agent_id: leader_id.clone(),
                member_agent_ids: Some(vec![member_id.clone()]),
            },
        )
        .unwrap();

        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();
        let run =
            create_team_run_impl(&db, team.id.clone(), conv.id.clone(), leader_id.clone())
                .unwrap();

        // Create a running task
        let task = create_team_task_impl(
            &db,
            run.id.clone(),
            member_id.clone(),
            "Do work".into(),
            None,
        )
        .unwrap();
        let _ = update_team_task_impl(
            &db,
            &task.id,
            Some(TaskStatus::Running),
            None,
            None,
            None,
        );

        // Run recovery
        let recovered = TeamOrchestrator::recover_runs(&db).unwrap();
        assert_eq!(recovered, 1);

        // Verify run is now failed
        let updated_run = get_team_run_impl(&db, &run.id).unwrap();
        assert_eq!(updated_run.status, TeamRunStatus::Failed);
        assert!(updated_run.finished_at.is_some());

        // Verify task is now failed
        let updated_tasks = get_team_tasks_impl(&db, &updated_run.id).unwrap();
        assert_eq!(updated_tasks[0].status, TaskStatus::Failed);
        assert!(updated_tasks[0]
            .result_summary
            .as_ref()
            .unwrap()
            .contains("Recovered on startup"));
    }

    #[test]
    fn test_recover_runs_no_running() {
        let db = setup_db();
        let recovered = TeamOrchestrator::recover_runs(&db).unwrap();
        assert_eq!(recovered, 0);
    }

    #[tokio::test]
    async fn test_handle_report_partial() {
        // This tests the DB-only part of handle_report (no app needed for emit)
        // We can't easily test the emit part without a full Tauri app handle
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let member1_id = create_test_agent(&db, "member1", "Member1");
        let member2_id = create_test_agent(&db, "member2", "Member2");

        let team = create_team_impl(
            &db,
            crate::db::models::CreateTeamRequest {
                name: "Test Team".into(),
                description: None,
                leader_agent_id: leader_id.clone(),
                member_agent_ids: Some(vec![member1_id.clone(), member2_id.clone()]),
            },
        )
        .unwrap();

        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();
        let run =
            create_team_run_impl(&db, team.id.clone(), conv.id.clone(), leader_id.clone())
                .unwrap();

        let task1 = create_team_task_impl(
            &db,
            run.id.clone(),
            member1_id.clone(),
            "Task 1".into(),
            None,
        )
        .unwrap();
        let task2 = create_team_task_impl(
            &db,
            run.id.clone(),
            member2_id.clone(),
            "Task 2".into(),
            None,
        )
        .unwrap();

        // Mark both as running
        let _ = update_team_task_impl(
            &db,
            &task1.id,
            Some(TaskStatus::Running),
            None,
            None,
            None,
        );
        let _ = update_team_task_impl(
            &db,
            &task2.id,
            Some(TaskStatus::Running),
            None,
            None,
            None,
        );

        // Directly update task1 to completed (simulating report without app handle)
        let _ = update_team_task_impl(
            &db,
            &task1.id,
            Some(TaskStatus::Completed),
            None,
            Some("Task 1 completed".into()),
            Some(Utc::now().to_rfc3339()),
        );

        // Check: not all done yet
        let tasks = get_team_tasks_impl(&db, &run.id).unwrap();
        let all_done = tasks
            .iter()
            .all(|t| matches!(t.status, TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled));
        assert!(!all_done);

        // Complete task2
        let _ = update_team_task_impl(
            &db,
            &task2.id,
            Some(TaskStatus::Completed),
            None,
            Some("Task 2 completed".into()),
            Some(Utc::now().to_rfc3339()),
        );

        // Now all done
        let tasks = get_team_tasks_impl(&db, &run.id).unwrap();
        let all_done = tasks
            .iter()
            .all(|t| matches!(t.status, TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled));
        assert!(all_done);
    }
}
