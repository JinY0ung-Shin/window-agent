import { create } from "zustand";
import type { ActiveRun } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useToolRunStore } from "./toolRunStore";

// ── Background stream tracking ────────────────────────
// Preserves in-flight stream info (msgId) across conversation switches so
// flushDelta can resume updating the correct pending message when the user
// navigates back.  Key = conversationId.
const backgroundStreams = new Map<string, { requestId: string; msgId: string }>();
// Accumulated streaming content per msgId — survives navigation so the
// restored pending message shows all previously received tokens.
const streamContentCache = new Map<string, string>();

export function cacheStreamContent(msgId: string, content: string): void {
  streamContentCache.set(msgId, content);
}

export function getCachedStreamContent(msgId: string): string {
  return streamContentCache.get(msgId) ?? "";
}

export function clearStreamContentCache(msgId: string): void {
  streamContentCache.delete(msgId);
}

export function shelveActiveRun(): void {
  const run = useStreamStore.getState().activeRun;
  if (run?.conversationId) {
    backgroundStreams.set(run.conversationId, {
      requestId: run.requestId,
      msgId: run.targetMessageId,
    });
  }
}

export function unshelveStream(conversationId: string): { requestId: string; msgId: string } | undefined {
  const entry = backgroundStreams.get(conversationId);
  if (entry) backgroundStreams.delete(conversationId);
  return entry;
}

export function clearShelvedStream(conversationId: string): void {
  backgroundStreams.delete(conversationId);
}

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

    // Always try to abort the backend stream (may be no-op if stream already done)
    try {
      await cmds.abortStream(activeRun.requestId);
    } catch {
      // Backend abort failed (e.g., requestId already removed) — proceed with cleanup
    }

    // Reset tool state if active (cancels pending approvals)
    const toolState = useToolRunStore.getState().toolRunState;
    if (toolState !== "idle") {
      useToolRunStore.getState().resetToolState();
    }

    // Always clear activeRun — either the backend abort succeeded and the
    // stream will end, or it was a no-op (stream already completed) and
    // this is stale state that needs cleanup.
    set({ activeRun: null });
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
