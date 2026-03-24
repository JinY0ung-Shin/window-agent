import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCronStore } from "../cronStore";
import type { CronJob, CronRun, CreateCronJobRequest, UpdateCronJobRequest } from "../../services/types";

vi.mock("../../services/commands/cronCommands", () => ({
  listCronJobs: vi.fn().mockResolvedValue([]),
  listCronJobsForAgent: vi.fn().mockResolvedValue([]),
  createCronJob: vi.fn().mockResolvedValue({ id: "job-new" }),
  updateCronJob: vi.fn().mockResolvedValue({ id: "job-1" }),
  deleteCronJob: vi.fn().mockResolvedValue(undefined),
  toggleCronJob: vi.fn().mockResolvedValue({ id: "job-1" }),
  listCronRuns: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const mockJob: CronJob = {
  id: "job-1",
  agent_id: "agent-1",
  name: "Test Job",
  description: "desc",
  schedule_type: "every",
  schedule_value: "1h",
  prompt: "do something",
  enabled: true,
  last_run_at: null,
  next_run_at: null,
  last_result: null,
  last_error: null,
  run_count: 0,
  claimed_at: null,
  created_at: "2026-01-01",
};

const mockRun: CronRun = {
  id: "run-1",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "success",
  prompt: "do something",
  result_summary: "done",
  error: null,
  started_at: "2026-01-01T00:00:00Z",
  finished_at: "2026-01-01T00:01:00Z",
};

const initial = useCronStore.getState();

beforeEach(() => {
  useCronStore.setState(initial, true);
  vi.clearAllMocks();
});

describe("cronStore", () => {
  // ── loadJobs ──

  it("loadJobs fetches and sets jobs", async () => {
    const { listCronJobs } = await import("../../services/commands/cronCommands");
    vi.mocked(listCronJobs).mockResolvedValue([mockJob]);

    await useCronStore.getState().loadJobs();

    expect(listCronJobs).toHaveBeenCalled();
    expect(useCronStore.getState().jobs).toEqual([mockJob]);
  });

  it("loadJobs sets empty array on error", async () => {
    const { listCronJobs } = await import("../../services/commands/cronCommands");
    vi.mocked(listCronJobs).mockRejectedValue(new Error("fail"));

    await useCronStore.getState().loadJobs();

    expect(useCronStore.getState().jobs).toEqual([]);
  });

  // ── loadJobsForAgent ──

  it("loadJobsForAgent fetches jobs for agent", async () => {
    const { listCronJobsForAgent } = await import("../../services/commands/cronCommands");
    vi.mocked(listCronJobsForAgent).mockResolvedValue([mockJob]);

    await useCronStore.getState().loadJobsForAgent("agent-1");

    expect(listCronJobsForAgent).toHaveBeenCalledWith("agent-1");
    expect(useCronStore.getState().jobs).toEqual([mockJob]);
  });

  it("loadJobsForAgent sets empty array on error", async () => {
    const { listCronJobsForAgent } = await import("../../services/commands/cronCommands");
    vi.mocked(listCronJobsForAgent).mockRejectedValue(new Error("fail"));

    await useCronStore.getState().loadJobsForAgent("agent-1");

    expect(useCronStore.getState().jobs).toEqual([]);
  });

  // ── createJob ──

  it("createJob calls command and reloads jobs", async () => {
    const { createCronJob, listCronJobs } = await import("../../services/commands/cronCommands");
    const newJob = { ...mockJob, id: "job-new" };
    vi.mocked(createCronJob).mockResolvedValue(newJob);
    vi.mocked(listCronJobs).mockResolvedValue([newJob]);

    const request: CreateCronJobRequest = {
      agent_id: "agent-1",
      name: "New Job",
      schedule_type: "every",
      schedule_value: "30m",
      prompt: "do new thing",
    };

    const result = await useCronStore.getState().createJob(request);

    expect(createCronJob).toHaveBeenCalledWith(request);
    expect(result).toEqual(newJob);
    expect(listCronJobs).toHaveBeenCalled();
  });

  // ── updateJob ──

  it("updateJob calls command and reloads jobs", async () => {
    const { updateCronJob, listCronJobs } = await import("../../services/commands/cronCommands");
    vi.mocked(updateCronJob).mockResolvedValue(mockJob);
    vi.mocked(listCronJobs).mockResolvedValue([mockJob]);

    const updates: UpdateCronJobRequest = { name: "Updated" };
    await useCronStore.getState().updateJob("job-1", updates);

    expect(updateCronJob).toHaveBeenCalledWith("job-1", updates);
    expect(listCronJobs).toHaveBeenCalled();
  });

  // ── deleteJob ──

  it("deleteJob removes job and reloads", async () => {
    const { deleteCronJob, listCronJobs } = await import("../../services/commands/cronCommands");
    vi.mocked(deleteCronJob).mockResolvedValue(undefined);
    vi.mocked(listCronJobs).mockResolvedValue([]);

    useCronStore.setState({ jobs: [mockJob] });

    await useCronStore.getState().deleteJob("job-1");

    expect(deleteCronJob).toHaveBeenCalledWith("job-1");
    expect(listCronJobs).toHaveBeenCalled();
  });

  it("deleteJob clears selectedJobId when deleting selected job", async () => {
    const { deleteCronJob, listCronJobs } = await import("../../services/commands/cronCommands");
    vi.mocked(deleteCronJob).mockResolvedValue(undefined);
    vi.mocked(listCronJobs).mockResolvedValue([]);

    useCronStore.setState({ selectedJobId: "job-1", runs: [mockRun] });

    await useCronStore.getState().deleteJob("job-1");

    expect(useCronStore.getState().selectedJobId).toBeNull();
    expect(useCronStore.getState().runs).toEqual([]);
  });

  it("deleteJob does not clear selectedJobId when deleting different job", async () => {
    const { deleteCronJob, listCronJobs } = await import("../../services/commands/cronCommands");
    vi.mocked(deleteCronJob).mockResolvedValue(undefined);
    vi.mocked(listCronJobs).mockResolvedValue([]);

    useCronStore.setState({ selectedJobId: "job-2" });

    await useCronStore.getState().deleteJob("job-1");

    expect(useCronStore.getState().selectedJobId).toBe("job-2");
  });

  // ── toggleJob ──

  it("toggleJob calls command and reloads", async () => {
    const { toggleCronJob, listCronJobs } = await import("../../services/commands/cronCommands");
    vi.mocked(toggleCronJob).mockResolvedValue(mockJob);
    vi.mocked(listCronJobs).mockResolvedValue([mockJob]);

    await useCronStore.getState().toggleJob("job-1", false);

    expect(toggleCronJob).toHaveBeenCalledWith("job-1", false);
    expect(listCronJobs).toHaveBeenCalled();
  });

  it("toggleJob handles error gracefully", async () => {
    const { toggleCronJob } = await import("../../services/commands/cronCommands");
    vi.mocked(toggleCronJob).mockRejectedValue(new Error("fail"));

    await useCronStore.getState().toggleJob("job-1", true);

    // Should not throw
  });

  // ── selectJob ──

  it("selectJob updates selectedJobId", () => {
    useCronStore.getState().selectJob("job-1");
    expect(useCronStore.getState().selectedJobId).toBe("job-1");
  });

  it("selectJob sets null", () => {
    useCronStore.setState({ selectedJobId: "job-1" });
    useCronStore.getState().selectJob(null);
    expect(useCronStore.getState().selectedJobId).toBeNull();
  });

  // ── openEditor / closeEditor ──

  it("openEditor sets isEditorOpen and editingJobId", () => {
    useCronStore.getState().openEditor("job-1");

    const s = useCronStore.getState();
    expect(s.isEditorOpen).toBe(true);
    expect(s.editingJobId).toBe("job-1");
  });

  it("openEditor without jobId sets editingJobId to null", () => {
    useCronStore.getState().openEditor();

    const s = useCronStore.getState();
    expect(s.isEditorOpen).toBe(true);
    expect(s.editingJobId).toBeNull();
  });

  it("closeEditor resets editor state", () => {
    useCronStore.setState({ isEditorOpen: true, editingJobId: "job-1" });

    useCronStore.getState().closeEditor();

    const s = useCronStore.getState();
    expect(s.isEditorOpen).toBe(false);
    expect(s.editingJobId).toBeNull();
  });

  // ── loadRuns ──

  it("loadRuns fetches and sets runs", async () => {
    const { listCronRuns } = await import("../../services/commands/cronCommands");
    vi.mocked(listCronRuns).mockResolvedValue([mockRun]);

    await useCronStore.getState().loadRuns("job-1");

    expect(listCronRuns).toHaveBeenCalledWith("job-1");
    expect(useCronStore.getState().runs).toEqual([mockRun]);
  });

  it("loadRuns sets empty array on error", async () => {
    const { listCronRuns } = await import("../../services/commands/cronCommands");
    vi.mocked(listCronRuns).mockRejectedValue(new Error("fail"));

    await useCronStore.getState().loadRuns("job-1");

    expect(useCronStore.getState().runs).toEqual([]);
  });

  // ── initial state ──

  it("has correct initial state", () => {
    const s = useCronStore.getState();
    expect(s.jobs).toEqual([]);
    expect(s.selectedJobId).toBeNull();
    expect(s.isEditorOpen).toBe(false);
    expect(s.editingJobId).toBeNull();
    expect(s.runs).toEqual([]);
  });
});
