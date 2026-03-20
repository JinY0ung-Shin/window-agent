import { create } from "zustand";
import type { Agent, PersonaFiles, ToolConfig } from "../services/types";
import * as cmds from "../services/tauriCommands";
import {
  readPersonaFiles,
  writePersonaFiles,
} from "../services/personaService";
import {
  readToolConfig,
  writeToolConfig,
  getDefaultToolConfig,
} from "../services/nativeToolRegistry";
import { i18n } from "../i18n";
import { useSettingsStore } from "./settingsStore";
import { logger } from "../services/logger";

interface AgentState {
  agents: Agent[];
  selectedAgentId: string | null;
  isEditorOpen: boolean;
  editingAgentId: string | null;
  personaFiles: PersonaFiles | null;
  personaTab: PersonaTab;
  editorError: string | null;
  toolConfig: ToolConfig | null;

  loadAgents: () => Promise<void>;
  selectAgent: (id: string | null) => void;
  openEditor: (agentId: string | null) => Promise<void>;
  closeEditor: () => void;
  setPersonaTab: (tab: PersonaTab) => void;
  updatePersonaFile: (fileName: PersonaTab, content: string) => void;
  saveAgent: (updates: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  loadToolConfig: (folderName: string) => Promise<void>;
  saveToolConfig: (folderName: string, config: ToolConfig) => Promise<void>;
}

export type PersonaTab = "identity" | "soul" | "user" | "agents";

const EMPTY_PERSONA: PersonaFiles = {
  identity: "",
  soul: "",
  user: "",
  agents: "",
};

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  isEditorOpen: false,
  editingAgentId: null,
  personaFiles: null,
  personaTab: "identity",
  editorError: null,
  toolConfig: null,

  loadAgents: async () => {
    try {
      const agents = await cmds.listAgents();
      set({ agents });
    } catch (e) {
      logger.debug("Failed to load agents", e);
      set({ agents: [] });
    }
  },

  selectAgent: (id) => set({ selectedAgentId: id }),

  openEditor: async (agentId) => {
    set({
      isEditorOpen: true,
      editingAgentId: agentId,
      personaTab: "identity",
      editorError: null,
      toolConfig: null,
    });

    if (agentId) {
      const agent = get().agents.find((a) => a.id === agentId);
      if (agent) {
        try {
          const files = await readPersonaFiles(agent.folder_name);
          set({ personaFiles: files });
        } catch (e) {
          logger.debug("Persona files read failed, using empty", e);
          set({ personaFiles: { ...EMPTY_PERSONA } });
        }

        const tc = await readToolConfig(agent.folder_name);
        if (tc) {
          set({ toolConfig: tc });
        } else {
          try {
            // TOOL_CONFIG.json missing — fall back to defaults
            const defaultConfig = await getDefaultToolConfig();
            set({ toolConfig: defaultConfig });
          } catch (e) {
            logger.debug("Failed to load default tool config", e);
          }
        }
      } else {
        set({ personaFiles: { ...EMPTY_PERSONA } });
      }
    } else {
      set({ personaFiles: { ...EMPTY_PERSONA } });
      // New agent: load default tool config so tools panel is pre-populated
      try {
        const defaultConfig = await getDefaultToolConfig();
        set({ toolConfig: defaultConfig });
      } catch (e) {
        logger.debug("Failed to load default tool config for new agent", e);
      }
    }
  },

  closeEditor: () =>
    set({
      isEditorOpen: false,
      editingAgentId: null,
      personaFiles: null,
      personaTab: "identity",
    }),

  setPersonaTab: (tab) => set({ personaTab: tab }),

  updatePersonaFile: (fileName, content) => {
    const current = get().personaFiles;
    if (!current) return;
    set({ personaFiles: { ...current, [fileName]: content } });
  },

  saveAgent: async (updates) => {
    const { editingAgentId, personaFiles, agents } = get();
    try {
      let folderName: string;

      if (editingAgentId) {
        // Update existing agent
        const agent = agents.find((a) => a.id === editingAgentId);
        folderName = agent?.folder_name ?? editingAgentId;

        await cmds.updateAgent(editingAgentId, {
          name: updates.name as string | undefined,
          description: updates.description,
          avatar: updates.avatar,
          model: updates.model,
          temperature: updates.temperature,
          thinking_enabled: updates.thinking_enabled,
          thinking_budget: updates.thinking_budget,
        });
      } else {
        // Create new agent — generate folder_name from name
        const name = (updates.name as string) || i18n.t("glossary:newAgent", { context: useSettingsStore.getState().uiTheme });
        folderName = name.replace(/\s+/g, "-").toLowerCase();

        const created = await cmds.createAgent({
          folder_name: folderName,
          name,
          description: updates.description,
          avatar: updates.avatar,
          model: updates.model,
          temperature: updates.temperature,
          thinking_enabled: updates.thinking_enabled,
          thinking_budget: updates.thinking_budget,
        });
        folderName = created.folder_name;
        set({ editingAgentId: created.id });
      }

      // Write persona files to disk
      if (personaFiles) {
        await writePersonaFiles(folderName, personaFiles);
      }

      // Write tool config separately (if null for new agent, write defaults)
      let { toolConfig } = get();
      if (!toolConfig && !editingAgentId) {
        try { toolConfig = await getDefaultToolConfig(); } catch (e) { logger.debug("Default tool config unavailable", e); }
      }
      if (toolConfig) {
        await writeToolConfig(folderName, toolConfig);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.error("Failed to save agent:", e);
      set({ editorError: i18n.t("glossary:agentSaveFailed", { error: errorMsg, context: useSettingsStore.getState().uiTheme }) });
      return;
    }

    set({ editorError: null });
    await get().loadAgents();
    get().closeEditor();
  },

  deleteAgent: async (id) => {
    try {
      await cmds.deleteAgent(id);
    } catch (e) {
      logger.error("Failed to delete agent:", e);
    }
    const { selectedAgentId } = get();
    if (selectedAgentId === id) {
      set({ selectedAgentId: null });
    }
    await get().loadAgents();
  },

  loadToolConfig: async (folderName) => {
    const tc = await readToolConfig(folderName);
    set({ toolConfig: tc });
  },

  saveToolConfig: async (folderName, config) => {
    await writeToolConfig(folderName, config);
    set({ toolConfig: config });
  },
}));
