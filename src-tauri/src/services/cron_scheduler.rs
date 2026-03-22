use crate::api::ApiState;
use crate::db::cron_operations::{
    claim_due_jobs_impl, complete_cron_run_impl, reset_stale_claims_impl,
};
use crate::db::models::{CronJob, CronRun};
use crate::db::Database;
use crate::memory::SystemMemoryManager;
use crate::services::actor_context::{self, ExecutionRole, ExecutionScope, ExecutionTrigger};
use crate::services::{api_service, credential_service};
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
        let default = std::time::Duration::from_secs(60);

        let result = db.with_conn(|conn| {
            let next: Option<String> = conn
                .query_row(
                    "SELECT MIN(next_run_at) FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND claimed_at IS NULL",
                    [],
                    |row| row.get(0),
                )
                .ok();

            Ok(next)
        });

        match result {
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
        conversation_id: String::new(),
        team_id: None,
        team_run_id: None,
        team_task_id: None,
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
    let mut system_parts = Vec::new();
    if !resolved.system_prompt.is_empty() {
        system_parts.push(resolved.system_prompt.clone());
    }
    if let Some(ref agents_sec) = resolved.registered_agents_section {
        system_parts.push(agents_sec.clone());
    }
    if let Some(ref mem) = resolved.consolidated_memory {
        system_parts.push(format!("[CONSOLIDATED MEMORY]\n{mem}"));
    }
    system_parts.push(
        actor_context::role_instruction(&scope.role)
            .unwrap_or("Complete the task below.")
            .to_string(),
    );
    let system_prompt = system_parts.join("\n\n");

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

    let mut body = serde_json::json!({
        "model": resolved.model,
        "messages": api_messages,
    });

    if let Some(temp) = resolved.temperature {
        body["temperature"] = serde_json::json!(temp);
    }

    // 3. Call API (non-streaming) with thinking fallback
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

    // Try with thinking first if enabled, fall back without on thinking-specific errors
    if resolved.thinking_enabled {
        if let Some(budget) = resolved.thinking_budget {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget,
            });
        }

        match api_service::do_completion(&client, &api_key, &base_url, &body, Some(&app)).await {
            Ok(resp) => {
                let summary = if resp.content.is_empty() {
                    resp.reasoning_content.as_deref().unwrap_or("(no content)").to_string()
                } else {
                    resp.content
                };
                finish_run(&app, &db, &job, &run, true, Some(&summary), None);
                return;
            }
            Err(e) => {
                if api_service::is_thinking_specific_error(&e) {
                    if let Some(obj) = body.as_object_mut() {
                        obj.remove("thinking");
                    }
                    // Fall through to retry without thinking
                } else {
                    let error_msg = e.to_string();
                    finish_run(&app, &db, &job, &run, false, None, Some(&error_msg));
                    return;
                }
            }
        }
    }

    let result = api_service::do_completion(&client, &api_key, &base_url, &body, Some(&app)).await;

    // 4. Store result
    match result {
        Ok(response) => {
            let summary = if response.content.is_empty() {
                response
                    .reasoning_content
                    .as_deref()
                    .unwrap_or("(no content)")
                    .to_string()
            } else {
                response.content
            };
            finish_run(&app, &db, &job, &run, true, Some(&summary), None);
        }
        Err(e) => {
            let error_msg = e.to_string();
            finish_run(&app, &db, &job, &run, false, None, Some(&error_msg));
        }
    }
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
