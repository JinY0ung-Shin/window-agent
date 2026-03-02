use crate::db::models::{self, Task};
use crate::db::Database;
use chrono::Utc;
use cron::Schedule;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

pub struct TaskScheduler {
    db: Arc<Database>,
}

impl TaskScheduler {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub async fn start(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            if let Err(e) = self.check_and_run() {
                eprintln!("Scheduler error: {}", e);
            }
        }
    }

    fn check_and_run(&self) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;

        let due_tasks = models::get_due_scheduled_tasks(&conn, &now)
            .map_err(|e| e.to_string())?;

        for sched in due_tasks {
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

            if let Err(e) = models::insert_task(&conn, &task) {
                eprintln!("Scheduler: failed to create task from '{}': {}", sched.title, e);
                continue;
            }

            let next_run = Self::compute_next_run(&sched.cron_expression);
            if let Err(e) = models::update_scheduled_task_run(
                &conn,
                &sched.id,
                &now,
                next_run.as_deref(),
            ) {
                eprintln!("Scheduler: failed to update run times for '{}': {}", sched.title, e);
            }
        }

        Ok(())
    }

    fn compute_next_run(cron_expr: &str) -> Option<String> {
        let schedule = Schedule::from_str(cron_expr).ok()?;
        schedule.upcoming(Utc).next().map(|dt| dt.to_rfc3339())
    }
}
