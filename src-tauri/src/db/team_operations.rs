use super::error::DbError;
use super::models::{
    CreateTeamRequest, TaskStatus, Team, TeamDetail, TeamMember, TeamRun, TeamRunStatus, TeamTask,
    UpdateTeamRequest,
};
use super::Database;
use chrono::Utc;
use uuid::Uuid;

// ── Column projections ──────────────────────────────────────

const TEAM_COLUMNS: &str =
    "SELECT id, name, description, leader_agent_id, created_at, updated_at FROM teams";

const MEMBER_COLUMNS: &str =
    "SELECT id, team_id, agent_id, role, joined_at FROM team_members";

const RUN_COLUMNS: &str =
    "SELECT id, team_id, conversation_id, leader_agent_id, status, started_at, finished_at FROM team_runs";

const TASK_COLUMNS: &str =
    "SELECT id, run_id, agent_id, request_id, task_description, status, parent_message_id, result_summary, started_at, finished_at FROM team_tasks";

// ── Row mappers ─────────────────────────────────────────────

fn row_to_team(row: &rusqlite::Row) -> Result<Team, rusqlite::Error> {
    Ok(Team {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        leader_agent_id: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn row_to_member(row: &rusqlite::Row) -> Result<TeamMember, rusqlite::Error> {
    Ok(TeamMember {
        id: row.get(0)?,
        team_id: row.get(1)?,
        agent_id: row.get(2)?,
        role: row.get(3)?,
        joined_at: row.get(4)?,
    })
}

fn row_to_run(row: &rusqlite::Row) -> Result<TeamRun, rusqlite::Error> {
    Ok(TeamRun {
        id: row.get(0)?,
        team_id: row.get(1)?,
        conversation_id: row.get(2)?,
        leader_agent_id: row.get(3)?,
        status: row.get(4)?,
        started_at: row.get(5)?,
        finished_at: row.get(6)?,
    })
}

fn row_to_task(row: &rusqlite::Row) -> Result<TeamTask, rusqlite::Error> {
    Ok(TeamTask {
        id: row.get(0)?,
        run_id: row.get(1)?,
        agent_id: row.get(2)?,
        request_id: row.get(3)?,
        task_description: row.get(4)?,
        status: row.get(5)?,
        parent_message_id: row.get(6)?,
        result_summary: row.get(7)?,
        started_at: row.get(8)?,
        finished_at: row.get(9)?,
    })
}

// ── Team CRUD ───────────────────────────────────────────────

pub fn create_team_impl(
    db: &Database,
    request: CreateTeamRequest,
) -> Result<Team, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let team = Team {
            id: Uuid::new_v4().to_string(),
            name: request.name,
            description: request.description.unwrap_or_default(),
            leader_agent_id: request.leader_agent_id,
            created_at: now.clone(),
            updated_at: now,
        };

        conn.execute(
            "INSERT INTO teams (id, name, description, leader_agent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                team.id,
                team.name,
                team.description,
                team.leader_agent_id,
                team.created_at,
                team.updated_at,
            ],
        )?;

        // Auto-add leader as a member with role 'leader'
        let leader_member_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO team_members (id, team_id, agent_id, role, joined_at) VALUES (?1, ?2, ?3, 'leader', ?4)",
            rusqlite::params![leader_member_id, team.id, team.leader_agent_id, team.created_at],
        )?;

        // Add additional members if provided
        if let Some(member_ids) = request.member_agent_ids {
            for agent_id in member_ids {
                if agent_id == team.leader_agent_id {
                    continue; // already added as leader
                }
                let member_id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO team_members (id, team_id, agent_id, role, joined_at) VALUES (?1, ?2, ?3, 'member', ?4)",
                    rusqlite::params![member_id, team.id, agent_id, team.created_at],
                )?;
            }
        }

        Ok(team)
    })
}

pub fn get_team_detail_impl(db: &Database, team_id: &str) -> Result<TeamDetail, DbError> {
    db.with_conn(|conn| {
        let team = conn.query_row(
            &format!("{TEAM_COLUMNS} WHERE id = ?1"),
            rusqlite::params![team_id],
            row_to_team,
        )?;

        let mut stmt = conn.prepare(
            &format!("{MEMBER_COLUMNS} WHERE team_id = ?1 ORDER BY joined_at ASC"),
        )?;
        let members = stmt
            .query_map(rusqlite::params![team_id], row_to_member)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(TeamDetail { team, members })
    })
}

pub fn list_teams_impl(db: &Database) -> Result<Vec<Team>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            &format!("{TEAM_COLUMNS} ORDER BY created_at ASC"),
        )?;
        let rows = stmt.query_map([], row_to_team)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn update_team_impl(
    db: &Database,
    team_id: &str,
    request: UpdateTeamRequest,
) -> Result<Team, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();

        let current = conn.query_row(
            &format!("{TEAM_COLUMNS} WHERE id = ?1"),
            rusqlite::params![team_id],
            row_to_team,
        )?;

        let name = request.name.unwrap_or(current.name);
        let description = request.description.unwrap_or(current.description);
        let leader_agent_id = request.leader_agent_id.unwrap_or(current.leader_agent_id);

        conn.execute(
            "UPDATE teams SET name = ?1, description = ?2, leader_agent_id = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![name, description, leader_agent_id, now, team_id],
        )?;

        let updated = conn.query_row(
            &format!("{TEAM_COLUMNS} WHERE id = ?1"),
            rusqlite::params![team_id],
            row_to_team,
        )?;
        Ok(updated)
    })
}

pub fn delete_team_impl(db: &Database, team_id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM teams WHERE id = ?1", rusqlite::params![team_id])?;
        Ok(())
    })
}

// ── Team Members ────────────────────────────────────────────

pub fn add_team_member_impl(
    db: &Database,
    team_id: String,
    agent_id: String,
    role: String,
) -> Result<TeamMember, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let member = TeamMember {
            id: Uuid::new_v4().to_string(),
            team_id,
            agent_id,
            role,
            joined_at: now,
        };

        conn.execute(
            "INSERT INTO team_members (id, team_id, agent_id, role, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                member.id,
                member.team_id,
                member.agent_id,
                member.role,
                member.joined_at,
            ],
        )?;

        Ok(member)
    })
}

pub fn remove_team_member_impl(
    db: &Database,
    team_id: &str,
    agent_id: &str,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM team_members WHERE team_id = ?1 AND agent_id = ?2",
            rusqlite::params![team_id, agent_id],
        )?;
        Ok(())
    })
}

// ── Team Runs ───────────────────────────────────────────────

pub fn create_team_run_impl(
    db: &Database,
    team_id: String,
    conversation_id: String,
    leader_agent_id: String,
) -> Result<TeamRun, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let run = TeamRun {
            id: Uuid::new_v4().to_string(),
            team_id,
            conversation_id,
            leader_agent_id,
            status: TeamRunStatus::Running,
            started_at: now,
            finished_at: None,
        };

        conn.execute(
            "INSERT INTO team_runs (id, team_id, conversation_id, leader_agent_id, status, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                run.id,
                run.team_id,
                run.conversation_id,
                run.leader_agent_id,
                run.status,
                run.started_at,
            ],
        )?;

        Ok(run)
    })
}

pub fn update_team_run_status_impl(
    db: &Database,
    run_id: &str,
    status: TeamRunStatus,
    finished_at: Option<String>,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE team_runs SET status = ?1, finished_at = ?2 WHERE id = ?3",
            rusqlite::params![status, finished_at, run_id],
        )?;
        Ok(())
    })
}

pub fn get_team_run_impl(db: &Database, run_id: &str) -> Result<TeamRun, DbError> {
    db.with_conn(|conn| {
        let run = conn.query_row(
            &format!("{RUN_COLUMNS} WHERE id = ?1"),
            rusqlite::params![run_id],
            row_to_run,
        )?;
        Ok(run)
    })
}

pub fn get_running_runs_impl(db: &Database) -> Result<Vec<TeamRun>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            &format!("{RUN_COLUMNS} WHERE status = 'running' ORDER BY started_at ASC"),
        )?;
        let rows = stmt.query_map([], row_to_run)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

// ── Team Tasks ──────────────────────────────────────────────

pub fn create_team_task_impl(
    db: &Database,
    run_id: String,
    agent_id: String,
    task_description: String,
    parent_message_id: Option<String>,
) -> Result<TeamTask, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let task = TeamTask {
            id: Uuid::new_v4().to_string(),
            run_id,
            agent_id,
            request_id: None,
            task_description,
            status: TaskStatus::Queued,
            parent_message_id,
            result_summary: None,
            started_at: Some(now),
            finished_at: None,
        };

        conn.execute(
            "INSERT INTO team_tasks (id, run_id, agent_id, task_description, status, parent_message_id, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                task.id,
                task.run_id,
                task.agent_id,
                task.task_description,
                task.status,
                task.parent_message_id,
                task.started_at,
            ],
        )?;

        Ok(task)
    })
}

pub fn update_team_task_impl(
    db: &Database,
    task_id: &str,
    status: Option<TaskStatus>,
    request_id: Option<String>,
    result_summary: Option<String>,
    finished_at: Option<String>,
) -> Result<TeamTask, DbError> {
    db.with_conn(|conn| {
        let current = conn.query_row(
            &format!("{TASK_COLUMNS} WHERE id = ?1"),
            rusqlite::params![task_id],
            row_to_task,
        )?;

        let status = status.unwrap_or(current.status);
        let request_id = request_id.or(current.request_id);
        let result_summary = result_summary.or(current.result_summary);
        let finished_at = finished_at.or(current.finished_at);

        conn.execute(
            "UPDATE team_tasks SET status = ?1, request_id = ?2, result_summary = ?3, finished_at = ?4 WHERE id = ?5",
            rusqlite::params![status, request_id, result_summary, finished_at, task_id],
        )?;

        let updated = conn.query_row(
            &format!("{TASK_COLUMNS} WHERE id = ?1"),
            rusqlite::params![task_id],
            row_to_task,
        )?;
        Ok(updated)
    })
}

pub fn get_team_tasks_impl(db: &Database, run_id: &str) -> Result<Vec<TeamTask>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            &format!("{TASK_COLUMNS} WHERE run_id = ?1 ORDER BY started_at ASC"),
        )?;
        let rows = stmt.query_map(rusqlite::params![run_id], row_to_task)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::agent_operations::create_agent_impl;
    use crate::db::models::CreateAgentRequest;
    use crate::db::operations::create_conversation_impl;

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

    fn default_create_team(leader_id: &str) -> CreateTeamRequest {
        CreateTeamRequest {
            name: "Test Team".into(),
            description: Some("A test team".into()),
            leader_agent_id: leader_id.into(),
            member_agent_ids: None,
        }
    }

    // ── Team CRUD tests ─────────────────────────────────────

    #[test]
    fn test_create_team() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        assert_eq!(team.name, "Test Team");
        assert_eq!(team.leader_agent_id, leader_id);
    }

    #[test]
    fn test_create_team_auto_adds_leader_member() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let detail = get_team_detail_impl(&db, &team.id).unwrap();
        assert_eq!(detail.members.len(), 1);
        assert_eq!(detail.members[0].agent_id, leader_id);
        assert_eq!(detail.members[0].role, "leader");
    }

    #[test]
    fn test_create_team_with_members() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let member_id = create_test_agent(&db, "member", "Member");
        let team = create_team_impl(
            &db,
            CreateTeamRequest {
                name: "Full Team".into(),
                description: None,
                leader_agent_id: leader_id.clone(),
                member_agent_ids: Some(vec![leader_id.clone(), member_id.clone()]),
            },
        )
        .unwrap();
        let detail = get_team_detail_impl(&db, &team.id).unwrap();
        assert_eq!(detail.members.len(), 2);
    }

    #[test]
    fn test_get_team_detail() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let detail = get_team_detail_impl(&db, &team.id).unwrap();
        assert_eq!(detail.team.id, team.id);
        assert!(!detail.members.is_empty());
    }

    #[test]
    fn test_list_teams() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let teams = list_teams_impl(&db).unwrap();
        assert_eq!(teams.len(), 1);
    }

    #[test]
    fn test_update_team() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let updated = update_team_impl(
            &db,
            &team.id,
            UpdateTeamRequest {
                name: Some("Updated".into()),
                description: None,
                leader_agent_id: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.description, "A test team"); // preserved
    }

    #[test]
    fn test_delete_team() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        delete_team_impl(&db, &team.id).unwrap();
        let teams = list_teams_impl(&db).unwrap();
        assert!(teams.is_empty());
    }

    #[test]
    fn test_delete_team_cascades_members() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let team_id = team.id.clone();
        delete_team_impl(&db, &team_id).unwrap();

        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM team_members WHERE team_id = ?1",
                rusqlite::params![team_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    // ── Member tests ────────────────────────────────────────

    #[test]
    fn test_add_and_remove_member() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let member_id = create_test_agent(&db, "member", "Member");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();

        let member = add_team_member_impl(&db, team.id.clone(), member_id.clone(), "member".into())
            .unwrap();
        assert_eq!(member.agent_id, member_id);

        let detail = get_team_detail_impl(&db, &team.id).unwrap();
        assert_eq!(detail.members.len(), 2);

        remove_team_member_impl(&db, &team.id, &member_id).unwrap();
        let detail = get_team_detail_impl(&db, &team.id).unwrap();
        assert_eq!(detail.members.len(), 1);
    }

    #[test]
    fn test_add_duplicate_member_fails() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        // Leader is already a member
        let result = add_team_member_impl(&db, team.id, leader_id, "member".into());
        assert!(result.is_err());
    }

    // ── Run tests ───────────────────────────────────────────

    #[test]
    fn test_create_and_get_run() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();

        let run = create_team_run_impl(
            &db,
            team.id.clone(),
            conv.id.clone(),
            leader_id.clone(),
        )
        .unwrap();
        assert_eq!(run.status, TeamRunStatus::Running);

        let fetched = get_team_run_impl(&db, &run.id).unwrap();
        assert_eq!(fetched.id, run.id);
    }

    #[test]
    fn test_update_run_status() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();
        let run = create_team_run_impl(&db, team.id, conv.id, leader_id).unwrap();

        let now = Utc::now().to_rfc3339();
        update_team_run_status_impl(&db, &run.id, TeamRunStatus::Completed, Some(now)).unwrap();

        let updated = get_team_run_impl(&db, &run.id).unwrap();
        assert_eq!(updated.status, TeamRunStatus::Completed);
        assert!(updated.finished_at.is_some());
    }

    #[test]
    fn test_get_running_runs() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();

        create_team_run_impl(&db, team.id.clone(), conv.id.clone(), leader_id.clone()).unwrap();
        let running = get_running_runs_impl(&db).unwrap();
        assert_eq!(running.len(), 1);

        // Complete the run
        update_team_run_status_impl(
            &db,
            &running[0].id,
            TeamRunStatus::Completed,
            Some(Utc::now().to_rfc3339()),
        )
        .unwrap();
        let running = get_running_runs_impl(&db).unwrap();
        assert!(running.is_empty());
    }

    // ── Task tests ──────────────────────────────────────────

    #[test]
    fn test_create_and_get_tasks() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();
        let run = create_team_run_impl(&db, team.id, conv.id, leader_id.clone()).unwrap();

        let task = create_team_task_impl(
            &db,
            run.id.clone(),
            leader_id,
            "Do something".into(),
            None,
        )
        .unwrap();
        assert_eq!(task.status, TaskStatus::Queued);

        let tasks = get_team_tasks_impl(&db, &run.id).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].task_description, "Do something");
    }

    #[test]
    fn test_update_task() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();
        let run = create_team_run_impl(&db, team.id, conv.id, leader_id.clone()).unwrap();
        let task = create_team_task_impl(&db, run.id, leader_id, "Task".into(), None).unwrap();

        let updated = update_team_task_impl(
            &db,
            &task.id,
            Some(TaskStatus::Completed),
            Some("req-123".into()),
            Some("Done successfully".into()),
            Some(Utc::now().to_rfc3339()),
        )
        .unwrap();

        assert_eq!(updated.status, TaskStatus::Completed);
        assert_eq!(updated.request_id, Some("req-123".into()));
        assert_eq!(updated.result_summary, Some("Done successfully".into()));
        assert!(updated.finished_at.is_some());
    }

    #[test]
    fn test_update_task_partial() {
        let db = setup_db();
        let leader_id = create_test_agent(&db, "leader", "Leader");
        let team = create_team_impl(&db, default_create_team(&leader_id)).unwrap();
        let conv = create_conversation_impl(&db, Some("Chat".into()), leader_id.clone()).unwrap();
        let run = create_team_run_impl(&db, team.id, conv.id, leader_id.clone()).unwrap();
        let task = create_team_task_impl(&db, run.id, leader_id, "Task".into(), None).unwrap();

        let updated = update_team_task_impl(
            &db,
            &task.id,
            Some(TaskStatus::Running),
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(updated.status, TaskStatus::Running);
        assert_eq!(updated.request_id, None); // preserved as None
    }
}
