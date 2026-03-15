import { create } from "zustand";
import * as cmds from "../services/tauriCommands";

interface BootstrapState {
  isBootstrapping: boolean;
  bootstrapFolderName: string | null;
  bootstrapApiHistory: any[];
  bootstrapFilesWritten: string[];

  startBootstrap: () => Promise<void>;
  cancelBootstrap: () => void;
  resetBootstrap: () => void;
}

const BOOTSTRAP_INITIAL = {
  isBootstrapping: false,
  bootstrapFolderName: null as string | null,
  bootstrapApiHistory: [] as any[],
  bootstrapFilesWritten: [] as string[],
};

export const useBootstrapStore = create<BootstrapState>((set, _get) => ({
  ...BOOTSTRAP_INITIAL,

  startBootstrap: async () => {
    const folderName = `agent-${Date.now()}`;
    let prompt: string;
    try {
      prompt = await cmds.getBootstrapPrompt();
    } catch {
      console.error("Failed to load bootstrap prompt");
      return;
    }
    set({
      isBootstrapping: true,
      bootstrapFolderName: folderName,
      bootstrapApiHistory: [{ role: "system", content: prompt }],
      bootstrapFilesWritten: [],
    });
  },

  cancelBootstrap: () => {
    set({ ...BOOTSTRAP_INITIAL });
  },

  resetBootstrap: () => {
    set({ ...BOOTSTRAP_INITIAL });
  },
}));
