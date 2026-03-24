import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  listTeams,
  createTeam,
  getTeamDetail,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  createTeamRun,
  updateTeamRunStatus,
  executeDelegation,
  handleTeamReport,
} from "../teamCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("teamCommands", () => {
  // ── Team CRUD ──

  it("listTeams calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const result = await listTeams();
    expect(invoke).toHaveBeenCalledWith("list_teams");
    expect(result).toEqual([]);
  });

  it("createTeam passes request object", async () => {
    const req = { name: "Team A", leader_agent_id: "a1" };
    const team = { id: "t1", ...req };
    vi.mocked(invoke).mockResolvedValue(team);
    const result = await createTeam(req);
    expect(invoke).toHaveBeenCalledWith("create_team", { request: req });
    expect(result).toEqual(team);
  });

  it("getTeamDetail passes teamId", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "t1", name: "Team A", members: [] });
    await getTeamDetail("t1");
    expect(invoke).toHaveBeenCalledWith("get_team_detail", { teamId: "t1" });
  });

  it("updateTeam passes teamId and request", async () => {
    const req = { name: "Updated Team" };
    const team = { id: "t1", name: "Updated Team" };
    vi.mocked(invoke).mockResolvedValue(team);
    const result = await updateTeam("t1", req);
    expect(invoke).toHaveBeenCalledWith("update_team", { teamId: "t1", request: req });
    expect(result).toEqual(team);
  });

  it("deleteTeam passes teamId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await deleteTeam("t1");
    expect(invoke).toHaveBeenCalledWith("delete_team", { teamId: "t1" });
  });

  // ── Team Members ──

  it("addTeamMember passes teamId, agentId, role", async () => {
    const member = { team_id: "t1", agent_id: "a1", role: "worker" };
    vi.mocked(invoke).mockResolvedValue(member);
    const result = await addTeamMember("t1", "a1", "worker");
    expect(invoke).toHaveBeenCalledWith("add_team_member", {
      teamId: "t1",
      agentId: "a1",
      role: "worker",
    });
    expect(result).toEqual(member);
  });

  it("removeTeamMember passes teamId and agentId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await removeTeamMember("t1", "a1");
    expect(invoke).toHaveBeenCalledWith("remove_team_member", { teamId: "t1", agentId: "a1" });
  });

  // ── Team Runs ──

  it("createTeamRun passes teamId, conversationId, leaderAgentId", async () => {
    const run = { id: "r1", team_id: "t1", conversation_id: "c1" };
    vi.mocked(invoke).mockResolvedValue(run);
    const result = await createTeamRun("t1", "c1", "a1");
    expect(invoke).toHaveBeenCalledWith("create_team_run", {
      teamId: "t1",
      conversationId: "c1",
      leaderAgentId: "a1",
    });
    expect(result).toEqual(run);
  });

  it("updateTeamRunStatus passes runId, status, and optional finishedAt", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await updateTeamRunStatus("r1", "completed", "2026-01-01T00:00:00Z");
    expect(invoke).toHaveBeenCalledWith("update_team_run_status", {
      runId: "r1",
      status: "completed",
      finishedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("updateTeamRunStatus passes finishedAt as undefined when not provided", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await updateTeamRunStatus("r1", "running");
    expect(invoke).toHaveBeenCalledWith("update_team_run_status", {
      runId: "r1",
      status: "running",
      finishedAt: undefined,
    });
  });

  // ── Orchestration ──

  it("executeDelegation passes all args with null context by default", async () => {
    vi.mocked(invoke).mockResolvedValue(["task-1", "task-2"]);
    const result = await executeDelegation("c1", "r1", ["a1", "a2"], "Do the thing");
    expect(invoke).toHaveBeenCalledWith("execute_delegation", {
      conversationId: "c1",
      runId: "r1",
      agentIds: ["a1", "a2"],
      task: "Do the thing",
      context: null,
    });
    expect(result).toEqual(["task-1", "task-2"]);
  });

  it("executeDelegation passes context when provided", async () => {
    vi.mocked(invoke).mockResolvedValue(["task-1"]);
    await executeDelegation("c1", "r1", ["a1"], "Task", "Some context");
    expect(invoke).toHaveBeenCalledWith("execute_delegation", {
      conversationId: "c1",
      runId: "r1",
      agentIds: ["a1"],
      task: "Task",
      context: "Some context",
    });
  });

  it("handleTeamReport passes all args with null details by default", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    const result = await handleTeamReport("r1", "task-1", "All done");
    expect(invoke).toHaveBeenCalledWith("handle_team_report", {
      runId: "r1",
      taskId: "task-1",
      summary: "All done",
      details: null,
    });
    expect(result).toBe(true);
  });

  it("handleTeamReport passes details when provided", async () => {
    vi.mocked(invoke).mockResolvedValue(false);
    const result = await handleTeamReport("r1", "task-1", "Done", "Extra details");
    expect(invoke).toHaveBeenCalledWith("handle_team_report", {
      runId: "r1",
      taskId: "task-1",
      summary: "Done",
      details: "Extra details",
    });
    expect(result).toBe(false);
  });
});
