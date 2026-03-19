import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TeamRun, TeamTask } from "../services/types";

interface TeamRunState {
  activeRuns: Record<string, TeamRun>;
  tasksByRun: Record<string, TeamTask[]>;

  addRun: (run: TeamRun) => void;
  updateRunStatus: (runId: string, status: string, finishedAt?: string) => void;
  removeRun: (runId: string) => void;
  addTask: (task: TeamTask) => void;
  updateTaskStatus: (taskId: string, status: string, resultSummary?: string) => void;
  getRunTasks: (runId: string) => TeamTask[];
  clearAll: () => void;
  setupListeners: () => Promise<() => void>;
}

export const useTeamRunStore = create<TeamRunState>((set, get) => ({
  activeRuns: {},
  tasksByRun: {},

  addRun: (run) =>
    set((state) => ({
      activeRuns: { ...state.activeRuns, [run.id]: run },
    })),

  updateRunStatus: (runId, status, finishedAt) =>
    set((state) => {
      const existing = state.activeRuns[runId];
      if (!existing) return state;
      return {
        activeRuns: {
          ...state.activeRuns,
          [runId]: {
            ...existing,
            status: status as TeamRun["status"],
            finished_at: finishedAt ?? existing.finished_at,
          },
        },
      };
    }),

  removeRun: (runId) =>
    set((state) => {
      const { [runId]: _, ...remainingRuns } = state.activeRuns;
      const { [runId]: __, ...remainingTasks } = state.tasksByRun;
      return { activeRuns: remainingRuns, tasksByRun: remainingTasks };
    }),

  addTask: (task) =>
    set((state) => {
      const existing = state.tasksByRun[task.run_id] ?? [];
      return {
        tasksByRun: {
          ...state.tasksByRun,
          [task.run_id]: [...existing, task],
        },
      };
    }),

  updateTaskStatus: (taskId, status, resultSummary) =>
    set((state) => {
      const updated: Record<string, TeamTask[]> = {};
      for (const [runId, tasks] of Object.entries(state.tasksByRun)) {
        updated[runId] = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: status as TeamTask["status"],
                result_summary: resultSummary ?? t.result_summary,
              }
            : t,
        );
      }
      return { tasksByRun: updated };
    }),

  getRunTasks: (runId) => get().tasksByRun[runId] ?? [],

  clearAll: () => set({ activeRuns: {}, tasksByRun: {} }),

  setupListeners: async () => {
    const unlisteners: UnlistenFn[] = [];

    // Listen for streaming chunks from team agents
    unlisteners.push(
      await listen<{ run_id: string; task_id: string; agent_id: string; chunk: string }>(
        "team-agent-stream-chunk",
        (event) => {
          // Stream chunks are handled by the chat flow layer;
          // here we ensure the task is marked as running
          const tasks = get().tasksByRun[event.payload.run_id] ?? [];
          const task = tasks.find((t) => t.id === event.payload.task_id);
          if (task && task.status === "queued") {
            get().updateTaskStatus(event.payload.task_id, "running");
          }
        },
      ),
    );

    // Listen for stream completion from team agents
    unlisteners.push(
      await listen<{ run_id: string; task_id: string; agent_id: string; result_summary?: string }>(
        "team-agent-stream-done",
        (event) => {
          get().updateTaskStatus(
            event.payload.task_id,
            "done",
            event.payload.result_summary,
          );
        },
      ),
    );

    // Listen for run cancellation
    unlisteners.push(
      await listen<{ run_id: string }>(
        "team-run-cancelled",
        (event) => {
          get().updateRunStatus(event.payload.run_id, "cancelled");
        },
      ),
    );

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  },
}));
