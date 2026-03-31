use crate::api::ApiState;
use crate::db::cron_operations::{
    claim_due_jobs_impl, complete_cron_run_impl, reset_stale_claims_impl,
};
use crate::db::models::{CronJob, CronRun};
use crate::db::Database;
use crate::memory::SystemMemoryManager;
use crate::services::actor_context::{self, ExecutionRole, ExecutionScope, ExecutionTrigger};
use crate::services::{api_service, credential_service, llm_helpers};
use crate::settings::AppSettings;
use chrono::Utc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

pub struct CronScheduler {
    notify: Arc<Notify>,
    enabled: AtomicBool,
}

impl CronScheduler {
    pub fn new() -> Self {
        Self {
            notify: Arc::new(Notify::new()),
            enabled: AtomicBool::new(true),
        }
    }

    pub fn notify_change(&self) {
        self.notify.notify_one();
    }

    #[allow(dead_code)]
    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Relaxed);
        self.notify_change();
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Main scheduler loop — runs as a background tokio task.
    pub async fn run(app: AppHandle) {
        let scheduler = app.state::<CronScheduler>();
        let db = app.state::<Database>();

        // Startup: reset stale claims (crash recovery)
        match reset_stale_claims_impl(&db, 30) {
            Ok(count) if count > 0 => {
                tracing::info!(count, "Reset stale cron claims on startup");
            }
            Err(e) => {
                tracing::warn!("Failed to reset stale cron claims: {e}");
            }
            _ => {}
        }

        // Startup: misfire coalesce — fire missed jobs once, recompute next_run_at
        Self::coalesce_misfires(&app, &db);

        loop {
            if !scheduler.is_enabled() {
                scheduler.notify.notified().await;
                continue;
            }

            let now = Utc::now();
            let now_str = now.to_rfc3339();

            // 1. Claim due jobs
            match claim_due_jobs_impl(&db, &now_str) {
                Ok(claimed) => {
                    for (job, run) in claimed {
                        let app_clone = app.clone();
                        tokio::spawn(async move {
                            execute_cron_job(app_clone, job, run).await;
                        });
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to claim due cron jobs: {e}");
                }
            }

            // 2. Compute sleep duration until next due job
            let sleep_duration = Self::compute_sleep_duration(&db);

            // 3. Wait: either sleep expires or notify wakes us
            tokio::select! {
                _ = tokio::time::sleep(sleep_duration) => {}
                _ = scheduler.notify.notified() => {}
            }
        }
    }

    /// Coalesce misfires: for each enabled job where next_run_at < now and not claimed,
    /// fire once then recompute next_run_at from now.
    fn coalesce_misfires(app: &AppHandle, db: &Database) {
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        match claim_due_jobs_impl(db, &now_str) {
            Ok(claimed) => {
                if !claimed.is_empty() {
                    tracing::info!(
                        count = claimed.len(),
                        "Coalescing missed cron jobs on startup"
                    );
                    for (job, run) in claimed {
                        let app_clone = app.clone();
                        tokio::spawn(async move {
                            execute_cron_job(app_clone, job, run).await;
                        });
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Failed to coalesce cron misfires: {e}");
            }
        }
    }

    /// Query the minimum next_run_at from enabled jobs and return the duration to sleep.
    fn compute_sleep_duration(db: &Database) -> std::time::Duration {
        use crate::db::cron_operations::get_min_next_run_at;

        let default = std::time::Duration::from_secs(60);

        match get_min_next_run_at(db) {
            Ok(Some(next_run_str)) => {
                if let Ok(next_run) = chrono::DateTime::parse_from_rfc3339(&next_run_str) {
                    let now = Utc::now();
                    let diff = next_run.signed_duration_since(now);
                    if diff.num_milliseconds() <= 0 {
                        // Already due or past — wake immediately
                        std::time::Duration::from_millis(100)
                    } else {
                        std::time::Duration::from_millis(diff.num_milliseconds() as u64)
                    }
                } else {
                    default
                }
            }
            _ => default,
        }
    }
}

/// Execute a single cron job: resolve agent context, call LLM, store result.
async fn execute_cron_job(app: AppHandle, job: CronJob, run: CronRun) {
    // Emit start event
    let _ = app.emit(
        "cron:job-started",
        serde_json::json!({
            "job_id": job.id,
            "run_id": run.id,
            "agent_id": job.agent_id,
        }),
    );

    let db = app.state::<Database>();
    let app_data_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            let error_msg = format!("Failed to resolve app data dir: {e}");
            finish_run(&app, &db, &job, &run, false, None, Some(&error_msg));
            return;
        }
    };

    // 1. Resolve agent context
    let scope = ExecutionScope {
        actor_agent_id: job.agent_id.clone(),
        role: ExecutionRole::CronExecution,
        trigger: ExecutionTrigger::BackendTriggered,
    };

    let memory_mgr = app.state::<SystemMemoryManager>();
    let resolved = match actor_context::resolve(&scope, &db, &app_data_dir, Some(&*memory_mgr)) {
        Ok(ctx) => ctx,
        Err(e) => {
            let error_msg = format!("Failed to resolve agent context: {e}");
            finish_run(&app, &db, &job, &run, false, None, Some(&error_msg));
            return;
        }
    };

    // 2. Build request body
    let system_prompt = llm_helpers::build_system_prompt(&resolved, &scope);

    let mut api_messages = vec![
        serde_json::json!({ "role": "system", "content": system_prompt }),
        serde_json::json!({ "role": "user", "content": job.prompt }),
    ];

    // Defense-in-depth: scrub any credential values that may have leaked into messages
    if let Ok(credentials) = credential_service::get_all_secret_values(&app) {
        if !credentials.is_empty() {
            credential_service::scrub_messages(&mut api_messages, &credentials);
        }
    }

    // 3. Build tools array from agent's enabled tools
    let tools = llm_helpers::build_tools_json(&resolved.enabled_tool_names);

    let mut body = serde_json::json!({
        "model": resolved.model,
        "messages": api_messages,
    });

    if !tools.is_empty() {
        body["tools"] = serde_json::json!(tools);
    }

    if let Some(temp) = resolved.temperature {
        body["temperature"] = serde_json::json!(temp);
    }

    // 4. Call API with tool execution loop
    let api_state = app.state::<ApiState>();
    let (api_key, base_url) = match api_state.effective() {
        Ok(pair) => pair,
        Err(e) => {
            let error_msg = format!("API state error: {e}");
            finish_run(&app, &db, &job, &run, false, None, Some(&error_msg));
            return;
        }
    };
    let client = match api_state.client() {
        Ok(c) => c,
        Err(e) => {
            let error_msg = format!("API client error: {e}");
            finish_run(&app, &db, &job, &run, false, None, Some(&error_msg));
            return;
        }
    };

    if resolved.thinking_enabled {
        if let Some(budget) = resolved.thinking_budget {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget,
            });
        }
    }

    let max_tool_iterations = app.state::<AppSettings>().get().max_tool_iterations as usize;

    for iteration in 0..max_tool_iterations {
        let result = api_service::do_completion(&client, &api_key, &base_url, &body, Some(&app)).await;

        // On first attempt with thinking, handle thinking-specific errors
        if iteration == 0 && resolved.thinking_enabled {
            if let Err(ref e) = result {
                if api_service::is_thinking_specific_error(e) {
                    if let Some(obj) = body.as_object_mut() {
                        obj.remove("thinking");
                    }
                    // Retry without thinking
                    continue;
                }
            }
        }

        let response = match result {
            Ok(r) => r,
            Err(e) => {
                let error_msg = e.to_string();
                finish_run(&app, &db, &job, &run, false, None, Some(&error_msg));
                return;
            }
        };

        // If no tool calls, we're done — return the text response
        if response.tool_calls.is_none() {
            let summary = if response.content.is_empty() {
                response.reasoning_content.as_deref().unwrap_or("(no content)").to_string()
            } else {
                response.content
            };
            finish_run(&app, &db, &job, &run, true, Some(&summary), None);
            return;
        }

        // Execute tool calls and feed results back
        let tool_calls = response.tool_calls.unwrap();

        // Append assistant message with tool calls to conversation
        if let Some(msgs) = body["messages"].as_array_mut() {
            let tc_json: Vec<serde_json::Value> = tool_calls.iter().map(|tc| {
                serde_json::json!({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    }
                })
            }).collect();
            msgs.push(serde_json::json!({
                "role": "assistant",
                "content": if response.content.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(response.content.clone()) },
                "tool_calls": tc_json,
            }));
        }

        // Execute each tool call (all auto-approved for cron)
        for tc in &tool_calls {
            let input: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                .unwrap_or(serde_json::json!({}));

            let tool_result = crate::commands::tool_commands::execute_tool_inner_public(
                &app, &db, &tc.function.name, &input, &job.agent_id,
            ).await;

            let output = match tool_result {
                Ok(val) => serde_json::to_string(&val).unwrap_or_else(|_| "{}".to_string()),
                Err(e) => format!("Tool error: {e}"),
            };

            // Append tool result message
            if let Some(msgs) = body["messages"].as_array_mut() {
                msgs.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": output,
                }));
            }
        }

        // Remove thinking after first successful call to avoid issues on subsequent turns
        if let Some(obj) = body.as_object_mut() {
            obj.remove("thinking");
        }
    }

    // Max iterations reached
    finish_run(
        &app, &db, &job, &run, false, None,
        Some("Max tool iterations reached"),
    );
}

/// Update DB and emit completion/failure event.
fn finish_run(
    app: &AppHandle,
    db: &Database,
    job: &CronJob,
    run: &CronRun,
    success: bool,
    result_summary: Option<&str>,
    error: Option<&str>,
) {
    if let Err(e) = complete_cron_run_impl(db, &job.id, &run.id, success, result_summary, error) {
        tracing::warn!("Failed to complete cron run {}: {e}", run.id);
    }

    let event = if success {
        "cron:job-completed"
    } else {
        "cron:job-failed"
    };
    let _ = app.emit(
        event,
        serde_json::json!({
            "job_id": job.id,
            "run_id": run.id,
            "success": success,
            "result_summary": result_summary,
            "error": error,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::cron_operations::*;
    use crate::db::models::{CreateAgentRequest, CreateCronJobRequest, CronScheduleType};
    use crate::db::agent_operations::create_agent_impl;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn create_test_agent(db: &Database) -> String {
        let agent = create_agent_impl(
            db,
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
                network_visible: None,
                sort_order: None,
            },
        )
        .unwrap();
        agent.id
    }

    #[test]
    fn test_cron_scheduler_new_default_enabled() {
        let scheduler = CronScheduler::new();
        assert!(scheduler.is_enabled());
    }

    #[test]
    fn test_cron_scheduler_set_enabled_false() {
        let scheduler = CronScheduler::new();
        scheduler.set_enabled(false);
        assert!(!scheduler.is_enabled());
    }

    #[test]
    fn test_cron_scheduler_set_enabled_toggle() {
        let scheduler = CronScheduler::new();
        scheduler.set_enabled(false);
        assert!(!scheduler.is_enabled());
        scheduler.set_enabled(true);
        assert!(scheduler.is_enabled());
    }

    #[test]
    fn test_cron_scheduler_notify_change_does_not_panic() {
        let scheduler = CronScheduler::new();
        // Should not panic even when no one is waiting
        scheduler.notify_change();
    }

    #[test]
    fn test_compute_sleep_duration_no_jobs() {
        let db = setup_db();
        let duration = CronScheduler::compute_sleep_duration(&db);
        assert_eq!(duration, std::time::Duration::from_secs(60));
    }

    #[test]
    fn test_compute_sleep_duration_with_future_job() {
        let db = setup_db();
        let agent_id = create_test_agent(&db);
        let _job = create_cron_job_impl(
            &db,
            CreateCronJobRequest {
                agent_id,
                name: "Future Job".into(),
                description: None,
                schedule_type: CronScheduleType::Every,
                schedule_value: "3600".into(),
                prompt: "test".into(),
                enabled: Some(true),
            },
        )
        .unwrap();

        // Job has next_run_at ~1 hour from now
        let duration = CronScheduler::compute_sleep_duration(&db);
        // Should be roughly 3600 seconds, but at least > 0
        assert!(duration.as_secs() > 0);
        assert!(duration.as_secs() <= 3601);
    }

    #[test]
    fn test_compute_sleep_duration_with_past_due_job() {
        let db = setup_db();
        let agent_id = create_test_agent(&db);
        let job = create_cron_job_impl(
            &db,
            CreateCronJobRequest {
                agent_id,
                name: "Past Job".into(),
                description: None,
                schedule_type: CronScheduleType::Every,
                schedule_value: "3600".into(),
                prompt: "test".into(),
                enabled: Some(true),
            },
        )
        .unwrap();

        // Set next_run_at to the past
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE cron_jobs SET next_run_at = '2020-01-01T00:00:00+00:00' WHERE id = ?1",
                rusqlite::params![job.id],
            )?;
            Ok(())
        })
        .unwrap();

        let duration = CronScheduler::compute_sleep_duration(&db);
        // Already due — should wake quickly (100ms)
        assert!(duration.as_millis() <= 100);
    }

    #[test]
    fn test_compute_sleep_duration_disabled_jobs_ignored() {
        let db = setup_db();
        let agent_id = create_test_agent(&db);
        let _job = create_cron_job_impl(
            &db,
            CreateCronJobRequest {
                agent_id,
                name: "Disabled Job".into(),
                description: None,
                schedule_type: CronScheduleType::Every,
                schedule_value: "3600".into(),
                prompt: "test".into(),
                enabled: Some(false),
            },
        )
        .unwrap();

        // No enabled jobs → default 60s
        let duration = CronScheduler::compute_sleep_duration(&db);
        assert_eq!(duration, std::time::Duration::from_secs(60));
    }
}
