import { create } from "zustand";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import type { OpenAIMessage } from "../services/commands/apiCommands";
import { logger } from "../services/logger";

interface BootstrapState {
  isBootstrapping: boolean;
  bootstrapFolderName: string | null;
  bootstrapApiHistory: OpenAIMessage[];
  bootstrapFilesWritten: string[];

  startBootstrap: () => Promise<void>;
  cancelBootstrap: () => void;
  resetBootstrap: () => void;
}

const BOOTSTRAP_INITIAL = {
  isBootstrapping: false,
  bootstrapFolderName: null as string | null,
  bootstrapApiHistory: [] as OpenAIMessage[],
  bootstrapFilesWritten: [] as string[],
};

export const useBootstrapStore = create<BootstrapState>((set, _get) => ({
  ...BOOTSTRAP_INITIAL,

  startBootstrap: async () => {
    const folderName = `agent-${Date.now()}`;
    const locale = useSettingsStore.getState().locale;
    let prompt: string;
    try {
      prompt = await cmds.getBootstrapPrompt(locale);
    } catch (e) {
      logger.error("Failed to load bootstrap prompt:", e);
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
