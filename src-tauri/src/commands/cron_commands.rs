use crate::db::cron_operations;
use crate::db::models::{
    CreateCronJobRequest, CronJob, CronRun, UpdateCronJobRequest,
};
use crate::db::Database;
use crate::error::AppError;
use crate::services::cron_scheduler::CronScheduler;
use tauri::State;

// ── Cron Job CRUD ───────────────────────────────────────────

#[tauri::command]
pub fn create_cron_job(
    db: State<'_, Database>,
    scheduler: State<'_, CronScheduler>,
    request: CreateCronJobRequest,
) -> Result<CronJob, AppError> {
    let job = cron_operations::create_cron_job_impl(&db, request)?;
    scheduler.notify_change();
    Ok(job)
}

#[tauri::command]
pub fn list_cron_jobs(db: State<'_, Database>) -> Result<Vec<CronJob>, AppError> {
    Ok(cron_operations::list_cron_jobs_impl(&db)?)
}

#[tauri::command]
pub fn list_cron_jobs_for_agent(
    db: State<'_, Database>,
    agent_id: String,
) -> Result<Vec<CronJob>, AppError> {
    Ok(cron_operations::list_cron_jobs_for_agent_impl(&db, &agent_id)?)
}

#[tauri::command]
pub fn get_cron_job(
    db: State<'_, Database>,
    id: String,
) -> Result<CronJob, AppError> {
    Ok(cron_operations::get_cron_job_impl(&db, &id)?)
}

#[tauri::command]
pub fn update_cron_job(
    db: State<'_, Database>,
    scheduler: State<'_, CronScheduler>,
    id: String,
    request: UpdateCronJobRequest,
) -> Result<CronJob, AppError> {
    let job = cron_operations::update_cron_job_impl(&db, &id, request)?;
    scheduler.notify_change();
    Ok(job)
}

#[tauri::command]
pub fn delete_cron_job(
    db: State<'_, Database>,
    scheduler: State<'_, CronScheduler>,
    id: String,
) -> Result<(), AppError> {
    cron_operations::delete_cron_job_impl(&db, &id)?;
    scheduler.notify_change();
    Ok(())
}

#[tauri::command]
pub fn toggle_cron_job(
    db: State<'_, Database>,
    scheduler: State<'_, CronScheduler>,
    id: String,
    enabled: bool,
) -> Result<CronJob, AppError> {
    let job = cron_operations::toggle_cron_job_impl(&db, &id, enabled)?;
    scheduler.notify_change();
    Ok(job)
}

// ── Cron Runs ───────────────────────────────────────────────

#[tauri::command]
pub fn list_cron_runs(
    db: State<'_, Database>,
    job_id: String,
    limit: Option<i64>,
) -> Result<Vec<CronRun>, AppError> {
    Ok(cron_operations::list_cron_runs_for_job_impl(&db, &job_id, limit)?)
}
