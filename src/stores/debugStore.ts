import { create } from "zustand";
import type { ToolCallLog } from "../services/types";
import * as cmds from "../services/tauriCommands";

interface DebugState {
  logs: ToolCallLog[];
  isOpen: boolean;
  filterByTool: string | null;
  filterByStatus: string[];

  loadLogs: (conversationId: string) => Promise<void>;
  addLog: (log: ToolCallLog) => void;
  updateLog: (id: string, updates: Partial<ToolCallLog>) => void;
  setOpen: (open: boolean) => void;
  setFilterByTool: (tool: string | null) => void;
  setFilterByStatus: (statuses: string[]) => void;
  clear: () => void;
  getFilteredLogs: () => ToolCallLog[];
}

export const useDebugStore = create<DebugState>((set, get) => ({
  logs: [],
  isOpen: false,
  filterByTool: null,
  filterByStatus: [],

  loadLogs: async (conversationId) => {
    try {
      const logs = await cmds.listToolCallLogs(conversationId);
      set({ logs });
    } catch {
      set({ logs: [] });
    }
  },

  addLog: (log) => {
    set({ logs: [...get().logs, log] });
  },

  updateLog: (id, updates) => {
    set({
      logs: get().logs.map((l) =>
        l.id === id ? { ...l, ...updates } : l,
      ),
    });
  },

  setOpen: (open) => set({ isOpen: open }),

  setFilterByTool: (tool) => set({ filterByTool: tool }),

  setFilterByStatus: (statuses) => set({ filterByStatus: statuses }),

  clear: () => set({ logs: [] }),

  getFilteredLogs: () => {
    const { logs, filterByTool, filterByStatus } = get();
    return logs.filter((log) => {
      if (filterByTool && log.tool_name !== filterByTool) return false;
      if (filterByStatus.length > 0 && !filterByStatus.includes(log.status)) return false;
      return true;
    });
  },
}));
