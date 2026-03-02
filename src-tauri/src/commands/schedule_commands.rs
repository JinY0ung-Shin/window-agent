use crate::db::models::{self, ScheduledTask, Task};
use crate::AppState;
use chrono::Utc;
use cron::Schedule;
use serde::Deserialize;
use std::str::FromStr;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct CreateScheduledTaskRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub cron_expression: String,
    pub assignee: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: String,
}

fn default_priority() -> String {
    "medium".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateScheduledTaskRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub cron_expression: Option<String>,
    pub assignee: Option<String>,
    pub priority: Option<String>,
    pub is_active: Option<bool>,
}

fn compute_next_run(cron_expr: &str) -> Option<String> {
    let schedule = Schedule::from_str(cron_expr).ok()?;
    schedule.upcoming(Utc).next().map(|dt| dt.to_rfc3339())
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_scheduled_task(
    state: State<AppState>,
    request: CreateScheduledTaskRequest,
) -> Result<ScheduledTask, String> {
    // Validate cron expression
    Schedule::from_str(&request.cron_expression)
        .map_err(|e| format!("Invalid cron expression: {}", e))?;

    let now = Utc::now().to_rfc3339();
    let next_run = compute_next_run(&request.cron_expression);

    let task = ScheduledTask {
        id: models::new_id(),
        title: request.title,
        description: request.description,
        cron_expression: request.cron_expression,
        assignee: request.assignee,
        priority: request.priority,
        is_active: true,
        last_run_at: None,
        next_run_at: next_run,
        created_at: now,
    };

    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::insert_scheduled_task(&conn, &task).map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_scheduled_tasks(
    state: State<AppState>,
    active_only: Option<bool>,
) -> Result<Vec<ScheduledTask>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_scheduled_tasks(&conn, active_only.unwrap_or(false)).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_scheduled_task(
    state: State<AppState>,
    task_id: String,
    request: UpdateScheduledTaskRequest,
) -> Result<ScheduledTask, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;

    let mut task = models::get_scheduled_task_by_id(&conn, &task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Scheduled task not found: {}", task_id))?;

    if let Some(title) = request.title {
        task.title = title;
    }
    if let Some(description) = request.description {
        task.description = description;
    }
    if let Some(cron_expression) = request.cron_expression {
        Schedule::from_str(&cron_expression)
            .map_err(|e| format!("Invalid cron expression: {}", e))?;
        task.next_run_at = compute_next_run(&cron_expression);
        task.cron_expression = cron_expression;
    }
    if let Some(assignee) = request.assignee {
        task.assignee = Some(assignee);
    }
    if let Some(priority) = request.priority {
        task.priority = priority;
    }
    if let Some(is_active) = request.is_active {
        task.is_active = is_active;
        if is_active {
            task.next_run_at = compute_next_run(&task.cron_expression);
        }
    }

    models::update_scheduled_task(&conn, &task).map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_scheduled_task(
    state: State<AppState>,
    task_id: String,
) -> Result<bool, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::delete_scheduled_task(&conn, &task_id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn trigger_scheduled_task(
    state: State<AppState>,
    task_id: String,
) -> Result<Task, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;

    let sched = models::get_scheduled_task_by_id(&conn, &task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Scheduled task not found: {}", task_id))?;

    let now = Utc::now().to_rfc3339();
    let task = Task {
        id: models::new_id(),
        title: sched.title.clone(),
        description: sched.description.clone(),
        assignee: sched.assignee.clone(),
        status: "pending".to_string(),
        priority: sched.priority.clone(),
        created_at: now.clone(),
        completed_at: None,
        updated_at: Some(now.clone()),
        parent_task_id: None,
        creator: Some(format!("scheduler:{}", sched.id)),
    };

    models::insert_task(&conn, &task).map_err(|e| e.to_string())?;

    // Update scheduled task run times
    let next_run = compute_next_run(&sched.cron_expression);
    models::update_scheduled_task_run(
        &conn,
        &task_id,
        &now,
        next_run.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    Ok(task)
}
