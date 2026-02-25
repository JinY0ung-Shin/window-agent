import { create } from "zustand";
import type { Agent, Department, CreateAgentRequest, UpdateAgentRequest } from "../services/types";
import {
  getAgents,
  getDepartments,
  hireAgent as hireAgentCmd,
  fireAgent as fireAgentCmd,
  updateAgent as updateAgentCmd,
} from "../services/tauriCommands";

interface HrState {
  agents: Agent[];
  departments: Department[];
  selectedAgent: Agent | null;
  showCreateModal: boolean;
  showEditModal: boolean;
  showFireModal: boolean;
  showProfileCard: boolean;
  loading: boolean;
  fetchAgents: () => Promise<void>;
  fetchDepartments: () => Promise<void>;
  setSelectedAgent: (agent: Agent | null) => void;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openEditModal: (agent?: Agent) => void;
  closeEditModal: () => void;
  openFireModal: (agent?: Agent) => void;
  closeFireModal: () => void;
  openProfileCard: (agent?: Agent) => void;
  closeProfileCard: () => void;
  hireAgent: (request: CreateAgentRequest) => Promise<void>;
  fireAgent: (agentId: string) => Promise<void>;
  updateAgent: (agentId: string, request: UpdateAgentRequest) => Promise<void>;
}

export const useHrStore = create<HrState>((set, get) => ({
  agents: [],
  departments: [],
  selectedAgent: null,
  showCreateModal: false,
  showEditModal: false,
  showFireModal: false,
  showProfileCard: false,
  loading: false,

  fetchAgents: async () => {
    set({ loading: true });
    const agents = await getAgents();
    set({ agents, loading: false });
  },

  fetchDepartments: async () => {
    const departments = await getDepartments();
    set({ departments });
  },

  setSelectedAgent: (agent) => set({ selectedAgent: agent }),

  openCreateModal: () => set({ showCreateModal: true }),
  closeCreateModal: () => set({ showCreateModal: false }),

  openEditModal: (agent?) => {
    if (agent) {
      set({ selectedAgent: agent, showEditModal: true });
    } else {
      set({ showEditModal: true });
    }
  },
  closeEditModal: () => set({ showEditModal: false, selectedAgent: null }),

  openFireModal: (agent?) => {
    if (agent) {
      set({ selectedAgent: agent, showFireModal: true });
    } else {
      set({ showFireModal: true });
    }
  },
  closeFireModal: () => set({ showFireModal: false, selectedAgent: null }),

  openProfileCard: (agent?) => {
    if (agent) {
      set({ selectedAgent: agent, showProfileCard: true });
    } else {
      set({ showProfileCard: true });
    }
  },
  closeProfileCard: () => set({ showProfileCard: false, selectedAgent: null }),

  hireAgent: async (request) => {
    await hireAgentCmd(request);
    await get().fetchAgents();
    set({ showCreateModal: false });
  },

  fireAgent: async (agentId) => {
    await fireAgentCmd(agentId);
    await get().fetchAgents();
    set({ showFireModal: false, selectedAgent: null });
  },

  updateAgent: async (agentId, request) => {
    await updateAgentCmd(agentId, request);
    await get().fetchAgents();
    set({ showEditModal: false, selectedAgent: null });
  },
}));
