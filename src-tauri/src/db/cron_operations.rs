use super::error::DbError;
use super::models::{
    CreateCronJobRequest, CronJob, CronRun, CronRunResult, CronScheduleType, UpdateCronJobRequest,
};
use super::Database;
use chrono::Utc;
use std::str::FromStr;
use uuid::Uuid;

// ── Column projections ──────────────────────────────────────

const CRON_JOB_COLUMNS: &str =
    "SELECT id, agent_id, name, description, schedule_type, schedule_value, prompt, enabled, last_run_at, next_run_at, last_result, last_error, run_count, claimed_at, created_at, updated_at FROM cron_jobs";

const CRON_RUN_COLUMNS: &str =
    "SELECT id, job_id, agent_id, status, prompt, result_summary, error, started_at, finished_at FROM cron_runs";

// ── Row mappers ─────────────────────────────────────────────

fn row_to_cron_job(row: &rusqlite::Row) -> Result<CronJob, rusqlite::Error> {
    let last_result_str: Option<String> = row.get(10)?;
    let last_result = last_result_str
        .as_deref()
        .map(|s| CronRunResult::from_str(s).ok())
        .flatten();

    Ok(CronJob {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        schedule_type: row.get(4)?,
        schedule_value: row.get(5)?,
        prompt: row.get(6)?,
        enabled: row.get(7)?,
        last_run_at: row.get(8)?,
        next_run_at: row.get(9)?,
        last_result,
        last_error: row.get(11)?,
        run_count: row.get(12)?,
        claimed_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn row_to_cron_run(row: &rusqlite::Row) -> Result<CronRun, rusqlite::Error> {
    Ok(CronRun {
        id: row.get(0)?,
        job_id: row.get(1)?,
        agent_id: row.get(2)?,
        status: row.get(3)?,
        prompt: row.get(4)?,
        result_summary: row.get(5)?,
        error: row.get(6)?,
        started_at: row.get(7)?,
        finished_at: row.get(8)?,
    })
}

// ── Validation ──────────────────────────────────────────────

pub fn validate_cron_job(
    schedule_type: &CronScheduleType,
    schedule_value: &str,
) -> Result<(), DbError> {
    match schedule_type {
        CronScheduleType::At => {
            chrono::DateTime::parse_from_rfc3339(schedule_value).map_err(|e| {
                DbError::Sqlite(format!("Invalid timestamp for 'at' schedule: {e}"))
            })?;
        }
        CronScheduleType::Every => {
            let secs: u64 = schedule_value.parse().map_err(|e| {
                DbError::Sqlite(format!("Invalid interval for 'every' schedule: {e}"))
            })?;
            if secs < 60 {
                return Err(DbError::Sqlite(
                    "Minimum interval is 60 seconds".to_string(),
                ));
            }
        }
        CronScheduleType::Cron => {
            let expr = format!("0 {schedule_value}");
            cron::Schedule::from_str(&expr).map_err(|e| {
                DbError::Sqlite(format!("Invalid cron expression: {e}"))
            })?;
        }
    }
    Ok(())
}

// ── next_run_at computation ─────────────────────────────────

pub fn compute_next_run_at(
    schedule_type: &CronScheduleType,
    schedule_value: &str,
    from_time: chrono::DateTime<Utc>,
) -> Option<String> {
    match schedule_type {
        CronScheduleType::At => {
            // next_run_at = the target timestamp itself
            Some(schedule_value.to_string())
        }
        CronScheduleType::Every => {
            let secs: u64 = schedule_value.parse().ok()?;
            let next = from_time + chrono::Duration::seconds(secs as i64);
            Some(next.to_rfc3339())
        }
        CronScheduleType::Cron => {
            let expr = format!("0 {schedule_value}");
            let schedule = cron::Schedule::from_str(&expr).ok()?;
            // Evaluate cron in local timezone, then convert to UTC
            let local_now = from_time.with_timezone(&chrono::Local);
            let next = schedule.after(&local_now).next()?;
            Some(next.with_timezone(&Utc).to_rfc3339())
        }
    }
}

// ── CRUD ────────────────────────────────────────────────────

pub fn create_cron_job_impl(
    db: &Database,
    request: CreateCronJobRequest,
) -> Result<CronJob, DbError> {
    validate_cron_job(&request.schedule_type, &request.schedule_value)?;

    db.with_conn(|conn| {
        let now = Utc::now();
        let now_str = now.to_rfc3339();
        let enabled = request.enabled.unwrap_or(true);
        let next_run_at = if enabled {
            compute_next_run_at(&request.schedule_type, &request.schedule_value, now)
        } else {
            None
        };

        let job = CronJob {
            id: Uuid::new_v4().to_string(),
            agent_id: request.agent_id,
            name: request.name,
            description: request.description.unwrap_or_default(),
            schedule_type: request.schedule_type,
            schedule_value: request.schedule_value,
            prompt: request.prompt,
            enabled,
            last_run_at: None,
            next_run_at,
            last_result: None,
            last_error: None,
            run_count: 0,
            claimed_at: None,
            created_at: now_str.clone(),
            updated_at: now_str,
        };

        conn.execute(
            "INSERT INTO cron_jobs (id, agent_id, name, description, schedule_type, schedule_value, prompt, enabled, next_run_at, run_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                job.id,
                job.agent_id,
                job.name,
                job.description,
                job.schedule_type,
                job.schedule_value,
                job.prompt,
                job.enabled,
                job.next_run_at,
                job.run_count,
                job.created_at,
                job.updated_at,
            ],
        )?;

        Ok(job)
    })
}

pub fn get_cron_job_impl(db: &Database, id: &str) -> Result<CronJob, DbError> {
    db.with_conn(|conn| {
        let job = conn.query_row(
            &format!("{CRON_JOB_COLUMNS} WHERE id = ?1"),
            rusqlite::params![id],
            row_to_cron_job,
        )?;
        Ok(job)
    })
}

pub fn list_cron_jobs_impl(db: &Database) -> Result<Vec<CronJob>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            &format!("{CRON_JOB_COLUMNS} ORDER BY created_at ASC"),
        )?;
        let rows = stmt.query_map([], row_to_cron_job)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn list_cron_jobs_for_agent_impl(
    db: &Database,
    agent_id: &str,
) -> Result<Vec<CronJob>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            &format!("{CRON_JOB_COLUMNS} WHERE agent_id = ?1 ORDER BY created_at ASC"),
        )?;
        let rows = stmt.query_map(rusqlite::params![agent_id], row_to_cron_job)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn update_cron_job_impl(
    db: &Database,
    id: &str,
    request: UpdateCronJobRequest,
) -> Result<CronJob, DbError> {
    db.with_conn(|conn| {
        let current = conn.query_row(
            &format!("{CRON_JOB_COLUMNS} WHERE id = ?1"),
            rusqlite::params![id],
            row_to_cron_job,
        )?;

        let name = request.name.unwrap_or(current.name);
        let description = request.description.unwrap_or(current.description);
        let schedule_changed =
            request.schedule_type.is_some() || request.schedule_value.is_some();
        let schedule_type = request.schedule_type.unwrap_or(current.schedule_type);
        let schedule_value = request
            .schedule_value
            .unwrap_or(current.schedule_value.clone());
        let prompt = request.prompt.unwrap_or(current.prompt);
        let enabled = request.enabled.unwrap_or(current.enabled);

        // Validate if schedule changed
        if schedule_changed {
            validate_cron_job(&schedule_type, &schedule_value)?;
        }

        let now = Utc::now();
        let now_str = now.to_rfc3339();

        // Recompute next_run_at only if schedule changed or enabled state changed
        let enabled_changed = enabled != current.enabled;
        let next_run_at = if !enabled {
            None
        } else if schedule_changed || enabled_changed {
            compute_next_run_at(&schedule_type, &schedule_value, now)
        } else {
            current.next_run_at.clone()
        };

        conn.execute(
            "UPDATE cron_jobs SET name = ?1, description = ?2, schedule_type = ?3, schedule_value = ?4, prompt = ?5, enabled = ?6, next_run_at = ?7, updated_at = ?8 WHERE id = ?9",
            rusqlite::params![
                name,
                description,
                schedule_type,
                schedule_value,
                prompt,
                enabled,
                next_run_at,
                now_str,
                id,
            ],
        )?;

        let updated = conn.query_row(
            &format!("{CRON_JOB_COLUMNS} WHERE id = ?1"),
            rusqlite::params![id],
            row_to_cron_job,
        )?;
        Ok(updated)
    })
}

pub fn delete_cron_job_impl(db: &Database, id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM cron_jobs WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    })
}

pub fn toggle_cron_job_impl(
    db: &Database,
    id: &str,
    enabled: bool,
) -> Result<CronJob, DbError> {
    db.with_conn(|conn| {
        let current = conn.query_row(
            &format!("{CRON_JOB_COLUMNS} WHERE id = ?1"),
            rusqlite::params![id],
            row_to_cron_job,
        )?;

        let now = Utc::now();
        let now_str = now.to_rfc3339();

        let next_run_at = if enabled {
            compute_next_run_at(&current.schedule_type, &current.schedule_value, now)
        } else {
            None
        };

        conn.execute(
            "UPDATE cron_jobs SET enabled = ?1, next_run_at = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![enabled, next_run_at, now_str, id],
        )?;

        let updated = conn.query_row(
            &format!("{CRON_JOB_COLUMNS} WHERE id = ?1"),
            rusqlite::params![id],
            row_to_cron_job,
        )?;
        Ok(updated)
    })
}

// ── Execution ───────────────────────────────────────────────

/// Atomically claim due jobs: set claimed_at + create cron_run in one transaction.
/// Returns the claimed jobs paired with their newly created run records.
pub fn claim_due_jobs_impl(
    db: &Database,
    now: &str,
) -> Result<Vec<(CronJob, CronRun)>, DbError> {
    db.with_conn(|conn| {
        // Find due jobs: enabled, next_run_at <= now, not already claimed
        let mut stmt = conn.prepare(
            &format!("{CRON_JOB_COLUMNS} WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1 AND claimed_at IS NULL"),
        )?;
        let due_jobs: Vec<CronJob> = stmt
            .query_map(rusqlite::params![now], row_to_cron_job)?
            .collect::<Result<Vec<_>, _>>()?;

        let mut results = Vec::new();

        for job in due_jobs {
            // Set claimed_at on the job
            conn.execute(
                "UPDATE cron_jobs SET claimed_at = ?1 WHERE id = ?2",
                rusqlite::params![now, job.id],
            )?;

            // Create a cron_run record
            let run = CronRun {
                id: Uuid::new_v4().to_string(),
                job_id: job.id.clone(),
                agent_id: job.agent_id.clone(),
                status: "running".to_string(),
                prompt: job.prompt.clone(),
                result_summary: None,
                error: None,
                started_at: now.to_string(),
                finished_at: None,
            };

            conn.execute(
                "INSERT INTO cron_runs (id, job_id, agent_id, status, prompt, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    run.id,
                    run.job_id,
                    run.agent_id,
                    run.status,
                    run.prompt,
                    run.started_at,
                ],
            )?;

            results.push((job, run));
        }

        Ok(results)
    })
}

/// Complete a cron run: update job stats and run record.
pub fn complete_cron_run_impl(
    db: &Database,
    job_id: &str,
    run_id: &str,
    success: bool,
    result_summary: Option<&str>,
    error: Option<&str>,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        let now = Utc::now();
        let now_str = now.to_rfc3339();
        let status = if success { "success" } else { "failed" };
        let last_result = if success {
            CronRunResult::Success
        } else {
            CronRunResult::Failed
        };

        // Update the run record
        conn.execute(
            "UPDATE cron_runs SET status = ?1, result_summary = ?2, error = ?3, finished_at = ?4 WHERE id = ?5",
            rusqlite::params![status, result_summary, error, now_str, run_id],
        )?;

        // Get current job to recompute next_run_at
        let job = conn.query_row(
            &format!("{CRON_JOB_COLUMNS} WHERE id = ?1"),
            rusqlite::params![job_id],
            row_to_cron_job,
        )?;

        // For 'at' schedule: auto-disable after firing
        let (enabled, next_run_at) = if job.schedule_type == CronScheduleType::At {
            (false, None)
        } else {
            (job.enabled, compute_next_run_at(&job.schedule_type, &job.schedule_value, now))
        };

        conn.execute(
            "UPDATE cron_jobs SET last_run_at = ?1, next_run_at = ?2, last_result = ?3, last_error = ?4, run_count = run_count + 1, claimed_at = NULL, enabled = ?5, updated_at = ?6 WHERE id = ?7",
            rusqlite::params![
                now_str,
                next_run_at,
                last_result,
                error,
                enabled,
                now_str,
                job_id,
            ],
        )?;

        Ok(())
    })
}

pub fn list_cron_runs_for_job_impl(
    db: &Database,
    job_id: &str,
    limit: Option<i64>,
) -> Result<Vec<CronRun>, DbError> {
    db.with_conn(|conn| {
        let limit_val = limit.unwrap_or(50);
        let mut stmt = conn.prepare(
            &format!("{CRON_RUN_COLUMNS} WHERE job_id = ?1 ORDER BY started_at DESC LIMIT ?2"),
        )?;
        let rows = stmt.query_map(rusqlite::params![job_id, limit_val], row_to_cron_run)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// Reset stale claims: clear claimed_at for jobs stuck longer than threshold,
/// and mark corresponding running cron_runs as failed.
pub fn reset_stale_claims_impl(
    db: &Database,
    threshold_minutes: i64,
) -> Result<u64, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now();
        let threshold = now - chrono::Duration::minutes(threshold_minutes);
        let threshold_str = threshold.to_rfc3339();
        let now_str = now.to_rfc3339();

        // Find stale claimed jobs
        let stale_job_ids: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT id FROM cron_jobs WHERE claimed_at IS NOT NULL AND claimed_at < ?1",
            )?;
            let result = stmt
                .query_map(rusqlite::params![threshold_str], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            result
        };

        let count = stale_job_ids.len() as u64;

        for job_id in &stale_job_ids {
            // Mark running cron_runs for this job as failed
            conn.execute(
                "UPDATE cron_runs SET status = 'failed', error = 'Stale claim reset (crash recovery)', finished_at = ?1 WHERE job_id = ?2 AND status = 'running'",
                rusqlite::params![now_str, job_id],
            )?;

            // Clear claimed_at on the job
            conn.execute(
                "UPDATE cron_jobs SET claimed_at = NULL, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now_str, job_id],
            )?;
        }

        Ok(count)
    })
}

/// 다음 실행 예정 시각 중 가장 빠른 값을 반환 (스케줄러 sleep 계산용)
pub fn get_min_next_run_at(db: &Database) -> Result<Option<String>, DbError> {
    db.with_conn(|conn| {
        let next: Option<String> = conn
            .query_row(
                "SELECT MIN(next_run_at) FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND claimed_at IS NULL",
                [],
                |row| row.get(0),
            )
            .ok();

        Ok(next)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::agent_operations::create_agent_impl;
    use crate::db::models::CreateAgentRequest;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("failed to create in-memory db")
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
                network_visible: None,
                sort_order: None,
            },
        )
        .unwrap();
        agent.id
    }

    fn default_create_job(agent_id: &str) -> CreateCronJobRequest {
        CreateCronJobRequest {
            agent_id: agent_id.into(),
            name: "Test Job".into(),
            description: Some("A test cron job".into()),
            schedule_type: CronScheduleType::Every,
            schedule_value: "3600".into(),
            prompt: "Do something".into(),
            enabled: Some(true),
        }
    }

    // ── Validation tests ────────────────────────────────────

    #[test]
    fn test_validate_at_valid() {
        let result = validate_cron_job(
            &CronScheduleType::At,
            "2030-01-01T00:00:00+00:00",
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_at_invalid() {
        let result = validate_cron_job(&CronScheduleType::At, "not-a-date");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_every_valid() {
        let result = validate_cron_job(&CronScheduleType::Every, "3600");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_every_too_short() {
        let result = validate_cron_job(&CronScheduleType::Every, "30");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_every_invalid() {
        let result = validate_cron_job(&CronScheduleType::Every, "abc");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_cron_valid() {
        let result = validate_cron_job(&CronScheduleType::Cron, "0 9 * * 1-5");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_cron_invalid() {
        let result = validate_cron_job(&CronScheduleType::Cron, "invalid cron");
        assert!(result.is_err());
    }

    // ── CRUD tests ──────────────────────────────────────────

    #[test]
    fn test_create_cron_job() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();
        assert_eq!(job.name, "Test Job");
        assert_eq!(job.agent_id, agent_id);
        assert!(job.enabled);
        assert!(job.next_run_at.is_some());
        assert_eq!(job.run_count, 0);
    }

    #[test]
    fn test_create_cron_job_disabled() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let mut req = default_create_job(&agent_id);
        req.enabled = Some(false);
        let job = create_cron_job_impl(&db, req).unwrap();
        assert!(!job.enabled);
        assert!(job.next_run_at.is_none());
    }

    #[test]
    fn test_get_cron_job() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();
        let fetched = get_cron_job_impl(&db, &job.id).unwrap();
        assert_eq!(fetched.id, job.id);
        assert_eq!(fetched.name, "Test Job");
    }

    #[test]
    fn test_list_cron_jobs() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();
        let jobs = list_cron_jobs_impl(&db).unwrap();
        assert_eq!(jobs.len(), 1);
    }

    #[test]
    fn test_list_cron_jobs_for_agent() {
        let db = setup_db();
        let a1 = create_test_agent(&db, "agent1", "Agent 1");
        let a2 = create_test_agent(&db, "agent2", "Agent 2");
        create_cron_job_impl(&db, default_create_job(&a1)).unwrap();
        create_cron_job_impl(&db, default_create_job(&a2)).unwrap();

        let jobs = list_cron_jobs_for_agent_impl(&db, &a1).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].agent_id, a1);
    }

    #[test]
    fn test_update_cron_job() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();

        let updated = update_cron_job_impl(
            &db,
            &job.id,
            UpdateCronJobRequest {
                name: Some("Updated Job".into()),
                description: None,
                schedule_type: None,
                schedule_value: None,
                prompt: None,
                enabled: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Updated Job");
        assert_eq!(updated.description, "A test cron job"); // preserved
    }

    #[test]
    fn test_delete_cron_job() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();
        delete_cron_job_impl(&db, &job.id).unwrap();
        let jobs = list_cron_jobs_impl(&db).unwrap();
        assert!(jobs.is_empty());
    }

    #[test]
    fn test_toggle_cron_job() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();
        assert!(job.enabled);

        let disabled = toggle_cron_job_impl(&db, &job.id, false).unwrap();
        assert!(!disabled.enabled);
        assert!(disabled.next_run_at.is_none());

        let enabled = toggle_cron_job_impl(&db, &job.id, true).unwrap();
        assert!(enabled.enabled);
        assert!(enabled.next_run_at.is_some());
    }

    // ── Execution tests ─────────────────────────────────────

    #[test]
    fn test_claim_due_jobs() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();

        // Set next_run_at to the past so it's due
        let past = "2020-01-01T00:00:00+00:00";
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE cron_jobs SET next_run_at = ?1 WHERE id = ?2",
                rusqlite::params![past, job.id],
            )?;
            Ok(())
        })
        .unwrap();

        let now = Utc::now().to_rfc3339();
        let claimed = claim_due_jobs_impl(&db, &now).unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].0.id, job.id);
        assert_eq!(claimed[0].1.status, "running");

        // Should not claim again (already claimed)
        let claimed_again = claim_due_jobs_impl(&db, &now).unwrap();
        assert!(claimed_again.is_empty());
    }

    #[test]
    fn test_complete_cron_run_success() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();

        // Set next_run_at to past and claim
        let past = "2020-01-01T00:00:00+00:00";
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE cron_jobs SET next_run_at = ?1 WHERE id = ?2",
                rusqlite::params![past, job.id],
            )?;
            Ok(())
        })
        .unwrap();

        let now = Utc::now().to_rfc3339();
        let claimed = claim_due_jobs_impl(&db, &now).unwrap();
        let (_, run) = &claimed[0];

        complete_cron_run_impl(&db, &job.id, &run.id, true, Some("Done"), None).unwrap();

        let updated_job = get_cron_job_impl(&db, &job.id).unwrap();
        assert!(updated_job.claimed_at.is_none());
        assert!(updated_job.last_run_at.is_some());
        assert_eq!(updated_job.last_result, Some(CronRunResult::Success));
        assert_eq!(updated_job.run_count, 1);
        assert!(updated_job.next_run_at.is_some()); // recomputed for 'every'

        let runs = list_cron_runs_for_job_impl(&db, &job.id, None).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "success");
        assert!(runs[0].finished_at.is_some());
    }

    #[test]
    fn test_complete_cron_run_at_auto_disables() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let req = CreateCronJobRequest {
            agent_id: agent_id.clone(),
            name: "One-shot".into(),
            description: None,
            schedule_type: CronScheduleType::At,
            schedule_value: "2030-06-01T00:00:00+00:00".into(),
            prompt: "Do it once".into(),
            enabled: Some(true),
        };
        let job = create_cron_job_impl(&db, req).unwrap();

        // Claim and complete
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE cron_jobs SET next_run_at = '2020-01-01T00:00:00+00:00' WHERE id = ?1",
                rusqlite::params![job.id],
            )?;
            Ok(())
        })
        .unwrap();

        let now = Utc::now().to_rfc3339();
        let claimed = claim_due_jobs_impl(&db, &now).unwrap();
        let (_, run) = &claimed[0];
        complete_cron_run_impl(&db, &job.id, &run.id, true, Some("Done"), None).unwrap();

        let updated = get_cron_job_impl(&db, &job.id).unwrap();
        assert!(!updated.enabled); // auto-disabled
        assert!(updated.next_run_at.is_none());
    }

    #[test]
    fn test_reset_stale_claims() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();

        // Simulate a stale claim (claimed 2 hours ago)
        let stale_time = (Utc::now() - chrono::Duration::hours(2)).to_rfc3339();
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE cron_jobs SET claimed_at = ?1, next_run_at = '2020-01-01T00:00:00+00:00' WHERE id = ?2",
                rusqlite::params![stale_time, job.id],
            )?;
            // Create a running cron_run
            conn.execute(
                "INSERT INTO cron_runs (id, job_id, agent_id, status, prompt, started_at) VALUES (?1, ?2, ?3, 'running', 'test', ?4)",
                rusqlite::params![Uuid::new_v4().to_string(), job.id, agent_id, stale_time],
            )?;
            Ok(())
        })
        .unwrap();

        let count = reset_stale_claims_impl(&db, 30).unwrap();
        assert_eq!(count, 1);

        let updated = get_cron_job_impl(&db, &job.id).unwrap();
        assert!(updated.claimed_at.is_none());

        let runs = list_cron_runs_for_job_impl(&db, &job.id, None).unwrap();
        assert_eq!(runs[0].status, "failed");
    }

    #[test]
    fn test_delete_job_cascades_runs() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        let job = create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();

        // Create a run manually
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO cron_runs (id, job_id, agent_id, status, prompt, started_at) VALUES (?1, ?2, ?3, 'success', 'test', ?4)",
                rusqlite::params![Uuid::new_v4().to_string(), job.id, agent_id, Utc::now().to_rfc3339()],
            )?;
            Ok(())
        })
        .unwrap();

        let job_id = job.id.clone();
        delete_cron_job_impl(&db, &job_id).unwrap();

        // Runs should be cascade deleted
        let runs = list_cron_runs_for_job_impl(&db, &job_id, None).unwrap();
        assert!(runs.is_empty());
    }

    #[test]
    fn test_delete_agent_cascades_jobs() {
        let db = setup_db();
        let agent_id = create_test_agent(&db, "agent1", "Agent 1");
        create_cron_job_impl(&db, default_create_job(&agent_id)).unwrap();

        // Delete the agent — should cascade to cron_jobs
        db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM agents WHERE id = ?1",
                rusqlite::params![agent_id],
            )?;
            Ok(())
        })
        .unwrap();

        let jobs = list_cron_jobs_impl(&db).unwrap();
        assert!(jobs.is_empty());
    }

    // ── next_run_at computation tests ───────────────────────

    #[test]
    fn test_compute_next_run_at_at() {
        let target = "2030-06-01T00:00:00+00:00";
        let result = compute_next_run_at(
            &CronScheduleType::At,
            target,
            Utc::now(),
        );
        assert_eq!(result, Some(target.to_string()));
    }

    #[test]
    fn test_compute_next_run_at_every() {
        let now = Utc::now();
        let result = compute_next_run_at(&CronScheduleType::Every, "3600", now);
        assert!(result.is_some());
        let next = chrono::DateTime::parse_from_rfc3339(&result.unwrap()).unwrap();
        let diff = next.signed_duration_since(now);
        assert!((diff.num_seconds() - 3600).abs() <= 1);
    }

    #[test]
    fn test_compute_next_run_at_cron() {
        let now = Utc::now();
        let result = compute_next_run_at(&CronScheduleType::Cron, "* * * * *", now);
        assert!(result.is_some());
        // "every minute" cron should produce a time in the future
        let next = chrono::DateTime::parse_from_rfc3339(&result.unwrap()).unwrap();
        assert!(next > now);
    }
}
