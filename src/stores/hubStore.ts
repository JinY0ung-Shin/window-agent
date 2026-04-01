import { create } from "zustand";
import {
  hubGetAuthStatus,
  hubLogin,
  hubRegister,
  hubLogout,
  hubListAgents,
  hubListSkills,
  hubListNotes,
  hubDeleteAgent,
  hubDeleteSkill,
  hubDeleteNote,
  type SharedAgent,
  type SharedSkill,
  type SharedNote,
} from "../services/commands/hubCommands";
import { logger } from "../services/logger";
import { toErrorMessage } from "../utils/errorUtils";

type HubTab = "agents" | "skills" | "notes";

export const PAGE_SIZE = 20;

interface HubState {
  initialized: boolean;

  // Auth
  loggedIn: boolean;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  authLoading: boolean;
  authError: string | null;

  // Browse
  activeTab: HubTab;
  searchQuery: string;

  // Agents
  agents: SharedAgent[];
  agentsTotal: number;
  agentsOffset: number;
  agentsLoading: boolean;

  // Skills
  skills: SharedSkill[];
  skillsTotal: number;
  skillsOffset: number;
  skillsLoading: boolean;

  // Notes
  notes: SharedNote[];
  notesTotal: number;
  notesOffset: number;
  notesLoading: boolean;

  // Selected agent detail
  selectedAgentId: string | null;
  agentSkills: SharedSkill[];
  agentNotes: SharedNote[];
  detailLoading: boolean;

  // Share dialog
  shareDialogOpen: boolean;
  shareAgentId: string | null;
  shareLoading: boolean;
  shareError: string | null;

  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, displayName?: string) => Promise<boolean>;
  logout: () => Promise<void>;

  setActiveTab: (tab: HubTab) => void;
  setSearchQuery: (q: string) => void;

  loadAgents: (offset?: number) => Promise<void>;
  loadSkills: (offset?: number) => Promise<void>;
  loadNotes: (offset?: number) => Promise<void>;

  selectAgent: (agentId: string) => Promise<void>;
  clearSelection: () => void;

  openShareDialog: (localAgentId: string) => void;
  closeShareDialog: () => void;

  deleteSharedAgent: (id: string) => Promise<boolean>;
  deleteSharedSkill: (id: string) => Promise<boolean>;
  deleteSharedNote: (id: string) => Promise<boolean>;
}

export const useHubStore = create<HubState>((set, get) => ({
  initialized: false,

  // Auth
  loggedIn: false,
  userId: null,
  email: null,
  displayName: null,
  authLoading: false,
  authError: null,

  // Browse
  activeTab: "agents",
  searchQuery: "",

  // Agents
  agents: [],
  agentsTotal: 0,
  agentsOffset: 0,
  agentsLoading: false,

  // Skills
  skills: [],
  skillsTotal: 0,
  skillsOffset: 0,
  skillsLoading: false,

  // Notes
  notes: [],
  notesTotal: 0,
  notesOffset: 0,
  notesLoading: false,

  // Selected agent detail
  selectedAgentId: null,
  agentSkills: [],
  agentNotes: [],
  detailLoading: false,

  // Share dialog
  shareDialogOpen: false,
  shareAgentId: null,
  shareLoading: false,
  shareError: null,

  error: null,

  initialize: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    try {
      const status = await hubGetAuthStatus();
      set({
        loggedIn: status.logged_in,
        userId: status.user_id,
        email: status.email,
        displayName: status.display_name,
      });
    } catch (e) {
      logger.debug("Hub auth status check failed:", e);
      set({ loggedIn: false, userId: null, email: null, displayName: null });
    }
  },

  login: async (email, password) => {
    set({ authLoading: true, authError: null });
    try {
      const status = await hubLogin(email, password);
      set({
        loggedIn: status.logged_in,
        userId: status.user_id,
        email: status.email,
        displayName: status.display_name,
        authLoading: false,
      });
      return true;
    } catch (e) {
      set({ authLoading: false, authError: toErrorMessage(e) });
      return false;
    }
  },

  register: async (email, password, displayName) => {
    set({ authLoading: true, authError: null });
    try {
      const status = await hubRegister(email, password, displayName);
      set({
        loggedIn: status.logged_in,
        userId: status.user_id,
        email: status.email,
        displayName: status.display_name,
        authLoading: false,
      });
      return true;
    } catch (e) {
      set({ authLoading: false, authError: toErrorMessage(e) });
      return false;
    }
  },

  logout: async () => {
    try {
      await hubLogout();
    } catch (e) {
      logger.debug("Hub logout failed:", e);
    }
    set({
      loggedIn: false,
      userId: null,
      email: null,
      displayName: null,
      authError: null,
      agents: [],
      agentsTotal: 0,
      agentsOffset: 0,
      skills: [],
      skillsTotal: 0,
      skillsOffset: 0,
      notes: [],
      notesTotal: 0,
      notesOffset: 0,
      selectedAgentId: null,
      agentSkills: [],
      agentNotes: [],
      searchQuery: "",
      error: null,
    });
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab, searchQuery: "" });
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
  },

  loadAgents: async (offset) => {
    const q = get().searchQuery || undefined;
    const resolvedOffset = offset ?? get().agentsOffset;
    set({ agentsLoading: true, error: null });
    try {
      const res = await hubListAgents(q, PAGE_SIZE, resolvedOffset);
      // Stale response guard
      if ((get().searchQuery || undefined) !== q) return;
      set({
        agents: res.items,
        agentsTotal: res.total,
        agentsOffset: resolvedOffset,
        agentsLoading: false,
      });
    } catch (e) {
      if ((get().searchQuery || undefined) !== q) return;
      set({ agentsLoading: false, error: toErrorMessage(e) });
    }
  },

  loadSkills: async (offset) => {
    const q = get().searchQuery || undefined;
    const resolvedOffset = offset ?? get().skillsOffset;
    set({ skillsLoading: true, error: null });
    try {
      const res = await hubListSkills(q, undefined, PAGE_SIZE, resolvedOffset);
      // Stale response guard
      if ((get().searchQuery || undefined) !== q) return;
      set({
        skills: res.items,
        skillsTotal: res.total,
        skillsOffset: resolvedOffset,
        skillsLoading: false,
      });
    } catch (e) {
      if ((get().searchQuery || undefined) !== q) return;
      set({ skillsLoading: false, error: toErrorMessage(e) });
    }
  },

  loadNotes: async (offset) => {
    const q = get().searchQuery || undefined;
    const resolvedOffset = offset ?? get().notesOffset;
    set({ notesLoading: true, error: null });
    try {
      const res = await hubListNotes(q, undefined, PAGE_SIZE, resolvedOffset);
      // Stale response guard
      if ((get().searchQuery || undefined) !== q) return;
      set({
        notes: res.items,
        notesTotal: res.total,
        notesOffset: resolvedOffset,
        notesLoading: false,
      });
    } catch (e) {
      if ((get().searchQuery || undefined) !== q) return;
      set({ notesLoading: false, error: toErrorMessage(e) });
    }
  },

  selectAgent: async (agentId) => {
    set({ selectedAgentId: agentId, detailLoading: true, agentSkills: [], agentNotes: [] });
    try {
      const [skillsRes, notesRes] = await Promise.all([
        hubListSkills(undefined, agentId, 100, 0),
        hubListNotes(undefined, agentId, 100, 0),
      ]);
      if (get().selectedAgentId !== agentId) return;
      set({
        agentSkills: skillsRes.items,
        agentNotes: notesRes.items,
        detailLoading: false,
      });
    } catch (e) {
      set({ detailLoading: false, error: toErrorMessage(e) });
    }
  },

  clearSelection: () => {
    set({ selectedAgentId: null, agentSkills: [], agentNotes: [] });
  },

  openShareDialog: (localAgentId) => {
    set({ shareDialogOpen: true, shareAgentId: localAgentId, shareError: null });
  },

  closeShareDialog: () => {
    set({ shareDialogOpen: false, shareAgentId: null, shareLoading: false, shareError: null });
  },

  deleteSharedAgent: async (id) => {
    try {
      await hubDeleteAgent(id);
      get().loadAgents(0);
      return true;
    } catch (e) {
      set({ error: toErrorMessage(e) });
      return false;
    }
  },

  deleteSharedSkill: async (id) => {
    try {
      await hubDeleteSkill(id);
      get().loadSkills(0);
      return true;
    } catch (e) {
      set({ error: toErrorMessage(e) });
      return false;
    }
  },

  deleteSharedNote: async (id) => {
    try {
      await hubDeleteNote(id);
      get().loadNotes(0);
      return true;
    } catch (e) {
      set({ error: toErrorMessage(e) });
      return false;
    }
  },
}));
