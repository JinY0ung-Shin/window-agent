import { invoke } from "@tauri-apps/api/core";
import type {
  Team,
  TeamDetail,
  TeamMember,
  TeamRun,
  TeamTask,
} from "../types";

// ── Team CRUD ──

export async function listTeams(): Promise<Team[]> {
  return invoke("list_teams");
}

export async function createTeam(request: {
  name: string;
  description?: string;
  leader_agent_id: string;
  member_agent_ids?: string[];
}): Promise<Team> {
  return invoke("create_team", { request });
}

export async function getTeamDetail(teamId: string): Promise<TeamDetail> {
  return invoke("get_team_detail", { teamId });
}

export async function updateTeam(
  teamId: string,
  request: { name?: string; description?: string; leader_agent_id?: string },
): Promise<Team> {
  return invoke("update_team", { teamId, request });
}

export async function deleteTeam(teamId: string): Promise<void> {
  return invoke("delete_team", { teamId });
}

// ── Team Members ──

export async function addTeamMember(
  teamId: string,
  agentId: string,
  role: string,
): Promise<TeamMember> {
  return invoke("add_team_member", { teamId, agentId, role });
}

export async function removeTeamMember(
  teamId: string,
  agentId: string,
): Promise<void> {
  return invoke("remove_team_member", { teamId, agentId });
}

// ── Team Runs ──

export async function createTeamRun(
  teamId: string,
  conversationId: string,
  leaderAgentId: string,
): Promise<TeamRun> {
  return invoke("create_team_run", { teamId, conversationId, leaderAgentId });
}

export async function updateTeamRunStatus(
  runId: string,
  status: string,
  finishedAt?: string,
): Promise<void> {
  return invoke("update_team_run_status", { runId, status, finishedAt });
}

export async function getTeamRun(runId: string): Promise<TeamRun> {
  return invoke("get_team_run", { runId });
}

export async function getRunningRuns(): Promise<TeamRun[]> {
  return invoke("get_running_runs");
}

// ── Team Tasks ──

export async function createTeamTask(
  runId: string,
  agentId: string,
  taskDescription: string,
  parentMessageId?: string,
): Promise<TeamTask> {
  return invoke("create_team_task", { runId, agentId, taskDescription, parentMessageId });
}

export async function updateTeamTask(
  taskId: string,
  updates: {
    status?: string;
    requestId?: string;
    resultSummary?: string;
    finishedAt?: string;
  },
): Promise<TeamTask> {
  return invoke("update_team_task", {
    taskId,
    status: updates.status,
    requestId: updates.requestId,
    resultSummary: updates.resultSummary,
    finishedAt: updates.finishedAt,
  });
}

export async function getTeamTasks(runId: string): Promise<TeamTask[]> {
  return invoke("get_team_tasks", { runId });
}

// ── Orchestration ──

export async function executeDelegation(
  conversationId: string,
  runId: string,
  agentIds: string[],
  task: string,
  context?: string,
): Promise<string[]> {
  return invoke("execute_delegation", {
    conversationId,
    runId,
    agentIds,
    task,
    context: context ?? null,
  });
}

export async function handleTeamReport(
  runId: string,
  taskId: string,
  summary: string,
  details?: string,
): Promise<boolean> {
  return invoke("handle_team_report", {
    runId,
    taskId,
    summary,
    details: details ?? null,
  });
}
