import { create } from "zustand";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import type { OpenAIMessage } from "../services/commands/apiCommands";
import { logger } from "../services/logger";

interface BootstrapState {
  isBootstrapping: boolean;
  bootstrapFolderName: string | null;
  bootstrapApiHistory: OpenAIMessage[];
  bootstrapFilesWritten: string[];
  isOnboarding: boolean;
  onboardingAgentId: string | null;

  startBootstrap: () => Promise<void>;
  cancelBootstrap: () => void;
  resetBootstrap: () => void;
  finishOnboarding: () => void;
}

const BOOTSTRAP_INITIAL = {
  isBootstrapping: false,
  bootstrapFolderName: null as string | null,
  bootstrapApiHistory: [] as OpenAIMessage[],
  bootstrapFilesWritten: [] as string[],
  isOnboarding: false,
  onboardingAgentId: null as string | null,
};

export const useBootstrapStore = create<BootstrapState>((set, get) => ({
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

  finishOnboarding: () => {
    const { onboardingAgentId } = get();
    if (onboardingAgentId) {
      useAgentStore.getState().selectAgent(onboardingAgentId);
    }
    set({ isOnboarding: false, onboardingAgentId: null });
  },
}));
