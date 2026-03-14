import { create } from "zustand";
import type { Agent, PersonaFiles } from "../services/types";
import * as cmds from "../services/tauriCommands";
import {
  readPersonaFiles,
  writePersonaFiles,
} from "../services/personaService";
import { DEFAULT_AGENT_NAME } from "../constants";

interface AgentState {
  agents: Agent[];
  selectedAgentId: string | null;
  isEditorOpen: boolean;
  editingAgentId: string | null;
  personaFiles: PersonaFiles | null;
  personaTab: PersonaTab;
  editorError: string | null;

  loadAgents: () => Promise<void>;
  selectAgent: (id: string | null) => void;
  openEditor: (agentId: string | null) => Promise<void>;
  closeEditor: () => void;
  setPersonaTab: (tab: PersonaTab) => void;
  updatePersonaFile: (fileName: PersonaTab, content: string) => void;
  saveAgent: (updates: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

export type PersonaTab = "identity" | "soul" | "user" | "agents" | "tools";

const EMPTY_PERSONA: PersonaFiles = {
  identity: "",
  soul: "",
  user: "",
  agents: "",
  tools: "",
};

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  isEditorOpen: false,
  editingAgentId: null,
  personaFiles: null,
  personaTab: "identity",
  editorError: null,

  loadAgents: async () => {
    try {
      const agents = await cmds.listAgents();
      set({ agents });
    } catch {
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
    });

    if (agentId) {
      try {
        const agent = get().agents.find((a) => a.id === agentId);
        if (agent) {
          const files = await readPersonaFiles(agent.folder_name);
          set({ personaFiles: files });
        } else {
          set({ personaFiles: { ...EMPTY_PERSONA } });
        }
      } catch {
        set({ personaFiles: { ...EMPTY_PERSONA } });
      }
    } else {
      set({ personaFiles: { ...EMPTY_PERSONA } });
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
        const name = (updates.name as string) || DEFAULT_AGENT_NAME;
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
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("Failed to save agent:", e);
      set({ editorError: `에이전트 저장 실패: ${errorMsg}` });
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
      console.error("Failed to delete agent:", e);
    }
    const { selectedAgentId } = get();
    if (selectedAgentId === id) {
      set({ selectedAgentId: null });
    }
    await get().loadAgents();
  },
}));
