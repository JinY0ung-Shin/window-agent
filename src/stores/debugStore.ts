import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ToolCallLog } from "../services/types";
import * as cmds from "../services/tauriCommands";

export interface HttpLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number | null;
  duration_ms: number | null;
  request_headers: string;
  response_headers: string;
  response_body_preview: string;
  error: string | null;
}

type DebugTab = "tools" | "http";

interface DebugState {
  logs: ToolCallLog[];
  httpLogs: HttpLogEntry[];
  activeTab: DebugTab;
  isOpen: boolean;
  filterByTool: string | null;
  filterByStatus: string[];

  loadLogs: (conversationId: string) => Promise<void>;
  addLog: (log: ToolCallLog) => void;
  updateLog: (id: string, updates: Partial<ToolCallLog>) => void;
  addHttpLog: (log: HttpLogEntry) => void;
  clearHttpLogs: () => void;
  setActiveTab: (tab: DebugTab) => void;
  setOpen: (open: boolean) => void;
  setFilterByTool: (tool: string | null) => void;
  setFilterByStatus: (statuses: string[]) => void;
  clear: () => void;
  getFilteredLogs: () => ToolCallLog[];
  setupHttpLogListener: () => Promise<UnlistenFn>;
}

export const useDebugStore = create<DebugState>((set, get) => ({
  logs: [],
  httpLogs: [],
  activeTab: "tools" as DebugTab,
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

  addHttpLog: (log) => {
    set({ httpLogs: [...get().httpLogs, log] });
  },

  clearHttpLogs: () => set({ httpLogs: [] }),

  setActiveTab: (tab) => set({ activeTab: tab }),

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

  setupHttpLogListener: async () => {
    return listen<HttpLogEntry>("debug:http-log", (event) => {
      get().addHttpLog(event.payload);
    });
  },
}));
