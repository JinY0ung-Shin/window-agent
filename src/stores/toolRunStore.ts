import { create } from "zustand";
import type { ToolCall, ToolRunState } from "../services/types";

const TOOL_APPROVAL_TIMEOUT_MS = 60_000;

interface ToolRunStoreState {
  toolRunState: ToolRunState;
  pendingToolCalls: ToolCall[];
  toolIterationCount: number;

  approveToolCall: () => void;
  rejectToolCall: () => void;
  setPending: (calls: ToolCall[], iterationCount: number) => void;
  setRunning: () => void;
  setWaiting: (calls: ToolCall[]) => void;
  setContinuing: () => void;
  resetToolState: () => void;
  waitForToolApproval: () => Promise<boolean>;
}

export const TOOL_RESET = {
  toolRunState: "idle" as ToolRunState,
  pendingToolCalls: [] as ToolCall[],
  toolIterationCount: 0,
};

let _toolApprovalResolve: ((approved: boolean) => void) | null = null;

export const useToolRunStore = create<ToolRunStoreState>((set, _get) => ({
  ...TOOL_RESET,

  approveToolCall: () => {
    set({ toolRunState: "tool_running" });
    if (_toolApprovalResolve) {
      _toolApprovalResolve(true);
      _toolApprovalResolve = null;
    }
  },

  rejectToolCall: () => {
    if (_toolApprovalResolve) {
      _toolApprovalResolve(false);
      _toolApprovalResolve = null;
    }
  },

  setPending: (calls, iterationCount) =>
    set({
      toolRunState: "tool_pending",
      pendingToolCalls: calls,
      toolIterationCount: iterationCount,
    }),

  setRunning: () =>
    set({ toolRunState: "tool_running" }),

  setWaiting: (calls) =>
    set({ toolRunState: "tool_waiting", pendingToolCalls: calls }),

  setContinuing: () =>
    set({ toolRunState: "continuing" }),

  resetToolState: () =>
    set({ ...TOOL_RESET }),

  waitForToolApproval: () => {
    return new Promise((resolve) => {
      _toolApprovalResolve = resolve;
      setTimeout(() => {
        if (_toolApprovalResolve === resolve) {
          _toolApprovalResolve = null;
          resolve(false);
        }
      }, TOOL_APPROVAL_TIMEOUT_MS);
    });
  },
}));
