import { describe, it, expect, beforeEach } from "vitest";
import { useTeamRunStore } from "../teamRunStore";
import type { TeamRun, TeamTask } from "../../services/types";

const makeRun = (overrides: Partial<TeamRun> = {}): TeamRun => ({
  id: "run-1",
  team_id: "team-1",
  conversation_id: "conv-1",
  leader_agent_id: "agent-1",
  status: "running",
  started_at: "2026-01-01",
  finished_at: null,
  ...overrides,
});

const makeTask = (overrides: Partial<TeamTask> = {}): TeamTask => ({
  id: "task-1",
  run_id: "run-1",
  agent_id: "agent-2",
  request_id: null,
  task_description: "do something",
  status: "queued",
  parent_message_id: null,
  result_summary: null,
  started_at: null,
  finished_at: null,
  ...overrides,
});

const initial = useTeamRunStore.getState();

beforeEach(() => {
  useTeamRunStore.setState(initial, true);
});

describe("teamRunStore", () => {
  it("addRun adds to activeRuns", () => {
    useTeamRunStore.getState().addRun(makeRun());
    expect(useTeamRunStore.getState().activeRuns["run-1"]).toBeDefined();
  });

  it("updateRunStatus updates existing run", () => {
    useTeamRunStore.getState().addRun(makeRun());
    useTeamRunStore.getState().updateRunStatus("run-1", "completed", "2026-01-02");
    const run = useTeamRunStore.getState().activeRuns["run-1"];
    expect(run.status).toBe("completed");
    expect(run.finished_at).toBe("2026-01-02");
  });

  it("updateRunStatus does nothing for non-existent run", () => {
    useTeamRunStore.getState().updateRunStatus("nonexistent", "completed");
    expect(useTeamRunStore.getState().activeRuns).toEqual({});
  });

  it("removeRun removes run and its tasks", () => {
    useTeamRunStore.getState().addRun(makeRun());
    useTeamRunStore.getState().addTask(makeTask());
    useTeamRunStore.getState().removeRun("run-1");
    expect(useTeamRunStore.getState().activeRuns["run-1"]).toBeUndefined();
    expect(useTeamRunStore.getState().tasksByRun["run-1"]).toBeUndefined();
  });

  it("addTask adds to tasksByRun", () => {
    useTeamRunStore.getState().addTask(makeTask({ id: "t1" }));
    useTeamRunStore.getState().addTask(makeTask({ id: "t2" }));
    expect(useTeamRunStore.getState().tasksByRun["run-1"]).toHaveLength(2);
  });

  it("updateTaskStatus updates matching task across all runs", () => {
    useTeamRunStore.getState().addTask(makeTask({ id: "t1", status: "queued" }));
    useTeamRunStore.getState().updateTaskStatus("t1", "completed", "done");
    const tasks = useTeamRunStore.getState().tasksByRun["run-1"];
    expect(tasks[0].status).toBe("completed");
    expect(tasks[0].result_summary).toBe("done");
  });

  it("getRunTasks returns tasks for a run", () => {
    useTeamRunStore.getState().addTask(makeTask());
    expect(useTeamRunStore.getState().getRunTasks("run-1")).toHaveLength(1);
  });

  it("getRunTasks returns empty for unknown run", () => {
    expect(useTeamRunStore.getState().getRunTasks("unknown")).toEqual([]);
  });

  it("clearAll resets state", () => {
    useTeamRunStore.getState().addRun(makeRun());
    useTeamRunStore.getState().addTask(makeTask());
    useTeamRunStore.getState().clearAll();
    expect(useTeamRunStore.getState().activeRuns).toEqual({});
    expect(useTeamRunStore.getState().tasksByRun).toEqual({});
  });
});
