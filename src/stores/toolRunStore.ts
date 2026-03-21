import { create } from "zustand";
import type { ToolCall, ToolRunState } from "../services/types";

const TOOL_APPROVAL_TIMEOUT_MS = 60_000;

const TOOL_RUN_INITIAL: { toolRunState: ToolRunState; pendingToolCalls: ToolCall[]; toolIterationCount: number } = {
  toolRunState: "idle",
  pendingToolCalls: [],
  toolIterationCount: 0,
};

interface ToolRunStoreState {
  /** Per-run tool state, keyed by requestId */
  toolRunStates: Record<string, ToolRunState>;
  pendingToolCallsByRun: Record<string, ToolCall[]>;

  /** Backward-compatible getters (return state for the default/first run) */
  toolRunState: ToolRunState;
  pendingToolCalls: ToolCall[];
  toolIterationCount: number;

  approveToolCall: (runIdOrEvent?: string | unknown) => void;
  rejectToolCall: (runIdOrEvent?: string | unknown) => void;
  setPending: (calls: ToolCall[], iterationCount: number, runId?: string) => void;
  setRunning: (runId?: string) => void;
  setWaiting: (calls: ToolCall[], runId?: string) => void;
  setContinuing: (runId?: string) => void;
  resetToolState: (runId?: string) => void;
  waitForToolApproval: (runId?: string) => Promise<boolean>;
}

const DEFAULT_RUN_ID = "__default__";

/** Per-run approval resolvers */
const _toolApprovalResolvers: Record<string, (approved: boolean) => void> = {};

function resolveRunId(runId?: string): string {
  return runId ?? DEFAULT_RUN_ID;
}

export const useToolRunStore = create<ToolRunStoreState>((set, _get) => ({
  toolRunStates: {},
  pendingToolCallsByRun: {},
  ...TOOL_RUN_INITIAL,

  approveToolCall: (runIdOrEvent?: string | unknown) => {
    const id = resolveRunId(typeof runIdOrEvent === "string" ? runIdOrEvent : undefined);
    set((state) => {
      const toolRunStates = { ...state.toolRunStates, [id]: "tool_running" as ToolRunState };
      const defaults = id === DEFAULT_RUN_ID
        ? { toolRunState: "tool_running" as ToolRunState }
        : {};
      return { toolRunStates, ...defaults };
    });
    const resolver = _toolApprovalResolvers[id];
    if (resolver) {
      resolver(true);
      delete _toolApprovalResolvers[id];
    }
  },

  rejectToolCall: (runIdOrEvent?: string | unknown) => {
    const id = resolveRunId(typeof runIdOrEvent === "string" ? runIdOrEvent : undefined);
    const resolver = _toolApprovalResolvers[id];
    if (resolver) {
      resolver(false);
      delete _toolApprovalResolvers[id];
    }
  },

  setPending: (calls, iterationCount, runId?: string) => {
    const id = resolveRunId(runId);
    set((state) => {
      const toolRunStates = { ...state.toolRunStates, [id]: "tool_pending" as ToolRunState };
      const pendingToolCallsByRun = { ...state.pendingToolCallsByRun, [id]: calls };
      const defaults = id === DEFAULT_RUN_ID
        ? { toolRunState: "tool_pending" as ToolRunState, pendingToolCalls: calls, toolIterationCount: iterationCount }
        : {};
      return { toolRunStates, pendingToolCallsByRun, ...defaults };
    });
  },

  setRunning: (runId?: string) => {
    const id = resolveRunId(runId);
    set((state) => {
      const toolRunStates = { ...state.toolRunStates, [id]: "tool_running" as ToolRunState };
      const defaults = id === DEFAULT_RUN_ID
        ? { toolRunState: "tool_running" as ToolRunState }
        : {};
      return { toolRunStates, ...defaults };
    });
  },

  setWaiting: (calls, runId?: string) => {
    const id = resolveRunId(runId);
    set((state) => {
      const toolRunStates = { ...state.toolRunStates, [id]: "tool_waiting" as ToolRunState };
      const pendingToolCallsByRun = { ...state.pendingToolCallsByRun, [id]: calls };
      const defaults = id === DEFAULT_RUN_ID
        ? { toolRunState: "tool_waiting" as ToolRunState, pendingToolCalls: calls }
        : {};
      return { toolRunStates, pendingToolCallsByRun, ...defaults };
    });
  },

  setContinuing: (runId?: string) => {
    const id = resolveRunId(runId);
    set((state) => {
      const toolRunStates = { ...state.toolRunStates, [id]: "continuing" as ToolRunState };
      const defaults = id === DEFAULT_RUN_ID
        ? { toolRunState: "continuing" as ToolRunState }
        : {};
      return { toolRunStates, ...defaults };
    });
  },

  resetToolState: (runId?: string) => {
    const id = resolveRunId(runId);
    set((state) => {
      const { [id]: _, ...restStates } = state.toolRunStates;
      const { [id]: __, ...restCalls } = state.pendingToolCallsByRun;
      const defaults = id === DEFAULT_RUN_ID
        ? { ...TOOL_RUN_INITIAL }
        : {};
      return { toolRunStates: restStates, pendingToolCallsByRun: restCalls, ...defaults };
    });
  },

  waitForToolApproval: (runId?: string) => {
    const id = resolveRunId(runId);
    return new Promise((resolve) => {
      _toolApprovalResolvers[id] = resolve;
      setTimeout(() => {
        if (_toolApprovalResolvers[id] === resolve) {
          delete _toolApprovalResolvers[id];
          resolve(false);
        }
      }, TOOL_APPROVAL_TIMEOUT_MS);
    });
  },
}));
