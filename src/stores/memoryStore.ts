import { create } from "zustand";
import type { MemoryNote } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { logger } from "../services/logger";

interface MemoryState {
  notes: MemoryNote[];
  currentAgentId: string | null;

  loadNotes: (agentId: string) => Promise<void>;
  addNote: (agentId: string, title: string, content: string) => Promise<void>;
  editNote: (id: string, title?: string, content?: string) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  clear: () => void;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  notes: [],
  currentAgentId: null,

  loadNotes: async (agentId) => {
    try {
      const notes = await cmds.listMemoryNotes(agentId);
      set({ notes, currentAgentId: agentId });
    } catch (e) {
      logger.debug("Memory notes load failed", e);
      set({ notes: [], currentAgentId: agentId });
    }
  },

  addNote: async (agentId, title, content) => {
    const note = await cmds.createMemoryNote(agentId, title, content);
    set({ notes: [...get().notes, note] });
  },

  editNote: async (id, title, content) => {
    const updated = await cmds.updateMemoryNote(id, title, content);
    set({
      notes: get().notes.map((n) => (n.id === id ? updated : n)),
    });
  },

  removeNote: async (id) => {
    await cmds.deleteMemoryNote(id);
    set({ notes: get().notes.filter((n) => n.id !== id) });
  },

  clear: () => set({ notes: [], currentAgentId: null }),
}));
