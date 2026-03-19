import { create } from "zustand";
import type { ActiveRun } from "../services/types";
import * as cmds from "../services/tauriCommands";

interface StreamState {
  /**
   * Default/DM run — backward compatible.
   * chatFlowStore sets this directly via setState({ activeRun: ... }).
   */
  activeRun: ActiveRun | null;

  /**
   * Multi-run map for team execution, keyed by requestId.
   * Team runs live here; DM runs use activeRun above.
   */
  runsById: Record<string, ActiveRun>;

  startRun: (run: ActiveRun) => void;
  endRun: () => void;
  abortStream: () => Promise<void>;

  /** Multi-run helpers (for team execution) */
  addRun: (runId: string, run: ActiveRun) => void;
  removeRun: (runId: string) => void;
  getActiveRuns: () => ActiveRun[];
}

export const useStreamStore = create<StreamState>((set, get) => ({
  activeRun: null,
  runsById: {},

  // Backward-compatible: sets activeRun for DM flow
  startRun: (run) => set({ activeRun: run }),

  // Backward-compatible: clears activeRun for DM flow
  endRun: () => set({ activeRun: null }),

  // Backward-compatible: aborts the DM activeRun
  abortStream: async () => {
    const { activeRun } = get();
    if (!activeRun) return;
    await cmds.abortStream(activeRun.requestId);
  },

  // Team multi-run: add a run to runsById
  addRun: (runId, run) =>
    set((state) => ({
      runsById: { ...state.runsById, [runId]: run },
    })),

  // Team multi-run: remove a run from runsById
  removeRun: (runId) =>
    set((state) => {
      const { [runId]: _, ...rest } = state.runsById;
      return { runsById: rest };
    }),

  // Returns all active runs (DM + team)
  getActiveRuns: () => {
    const { activeRun, runsById } = get();
    const runs = Object.values(runsById);
    if (activeRun) runs.unshift(activeRun);
    return runs;
  },
}));
