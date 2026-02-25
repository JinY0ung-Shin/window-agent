import { create } from "zustand";
import type { Agent, Task } from "../services/types";
import { getAgents, getTasks } from "../services/tauriCommands";

interface AgentState {
  agents: Agent[];
  tasks: Task[];
  loading: boolean;
  fetchAgents: () => Promise<void>;
  fetchTasks: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  tasks: [],
  loading: false,
  fetchAgents: async () => {
    set({ loading: true });
    const agents = await getAgents();
    set({ agents, loading: false });
  },
  fetchTasks: async () => {
    const tasks = await getTasks();
    set({ tasks });
  },
}));
