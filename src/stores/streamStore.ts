import { create } from "zustand";
import type { ActiveRun } from "../services/types";
import * as cmds from "../services/tauriCommands";

interface StreamState {
  activeRun: ActiveRun | null;

  startRun: (run: ActiveRun) => void;
  endRun: () => void;
  abortStream: () => Promise<void>;
}

export const useStreamStore = create<StreamState>((set, get) => ({
  activeRun: null,

  startRun: (run) => set({ activeRun: run }),

  endRun: () => set({ activeRun: null }),

  abortStream: async () => {
    const { activeRun } = get();
    if (!activeRun) return;
    await cmds.abortStream(activeRun.requestId);
  },
}));
