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
  hubShareAgent,
  hubShareSkills,
  hubShareNotes,
  type SharedAgent,
  type SharedSkill,
  type SharedNote,
  type ShareSkillItem,
  type ShareNoteItem,
} from "../services/commands/hubCommands";
import { listSkills, readSkill, createSkill, updateSkill } from "../services/commands/skillCommands";
import { listMemoryNotes, createMemoryNote } from "../services/commands/memoryCommands";
import { createAgent } from "../services/commands/agentCommands";
import { readPersonaFiles, writePersonaFiles } from "../services/personaService";
import { useAgentStore } from "./agentStore";
import type { SkillMetadata, MemoryNote } from "../services/types";
import type { PersonaData } from "../services/commands/hubCommands";
import { logger } from "../services/logger";
import { toErrorMessage } from "../utils/errorUtils";

type HubTab = "agents" | "skills" | "mine";

export const PAGE_SIZE = 20;

type ShareStep = "form" | "result";
type ShareMode = "agent" | "skill";

interface ShareResult {
  success: boolean;
  agentId?: string;
  skillsShared: number;
  notesShared: number;
  error?: string;
}

interface InstallResult {
  installed: string[];
  skipped: string[];
  errors: string[];
}

function buildHiredPersona(name: string, description: string, sharedAgent?: SharedAgent) {
  const identity = sharedAgent?.persona?.identity?.trim();
  const fallbackDescription = description.trim();

  return {
    identity: identity || `# ${name}${fallbackDescription ? `\n\n${fallbackDescription}` : ""}`,
    soul: sharedAgent?.persona?.soul || "",
    user: sharedAgent?.persona?.user_context || "",
    agents: sharedAgent?.persona?.agents || "",
  };
}

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
  shareMode: ShareMode;
  shareAgentId: string | null;   // local agent id
  shareFolderName: string;
  shareAgentName: string;
  shareAgentDesc: string;
  shareStep: ShareStep;
  shareLoading: boolean;
  shareError: string | null;
  localSkills: SkillMetadata[];
  localNotes: MemoryNote[];
  selectedSkillNames: Set<string>;
  selectedNoteIds: Set<string>;
  shareResult: ShareResult | null;

  // Install
  installPopoverOpen: boolean;
  installItemType: "skill" | "note" | "agent" | null;
  installSkill: SharedSkill | null;
  installNote: SharedNote | null;
  installLoading: boolean;
  installResult: InstallResult | null;

  // My shares
  myAgents: SharedAgent[];
  myAgentsTotal: number;
  mySkills: SharedSkill[];
  mySkillsTotal: number;
  myNotes: SharedNote[];
  myNotesTotal: number;
  myLoading: boolean;

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

  // Share actions
  openShareDialog: (agentId: string, folderName: string, name: string, description: string) => void;
  openShareSkillDialog: (folderName: string) => void;
  closeShareDialog: () => void;
  loadLocalContent: (folderName: string, agentId: string) => Promise<void>;
  toggleSkillSelection: (name: string) => void;
  toggleNoteSelection: (id: string) => void;
  toggleAllSkills: (selected: boolean) => void;
  toggleAllNotes: (selected: boolean) => void;
  setShareAgentName: (name: string) => void;
  setShareAgentDesc: (desc: string) => void;
  executeShare: () => Promise<void>;

  // Install actions
  openInstallSkill: (skill: SharedSkill) => void;
  openInstallNote: (note: SharedNote) => void;
  openInstallAgent: () => void;
  closeInstall: () => void;
  executeInstallSkill: (folderName: string, skill: SharedSkill) => Promise<InstallResult>;
  executeInstallNote: (agentId: string, note: SharedNote) => Promise<InstallResult>;
  executeInstallBulk: (folderName: string, agentId: string) => Promise<InstallResult>;
  hireAgent: (name: string, description: string) => Promise<InstallResult | null>;

  // My shares actions
  loadMyShares: () => Promise<void>;

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
  shareMode: "agent" as ShareMode,
  shareAgentId: null,
  shareFolderName: "",
  shareAgentName: "",
  shareAgentDesc: "",
  shareStep: "form",
  shareLoading: false,
  shareError: null,
  localSkills: [],
  localNotes: [],
  selectedSkillNames: new Set<string>(),
  selectedNoteIds: new Set<string>(),
  shareResult: null,

  // Install
  installPopoverOpen: false,
  installItemType: null,
  installSkill: null,
  installNote: null,
  installLoading: false,
  installResult: null,

  // My shares
  myAgents: [],
  myAgentsTotal: 0,
  mySkills: [],
  mySkillsTotal: 0,
  myNotes: [],
  myNotesTotal: 0,
  myLoading: false,

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
      myAgents: [],
      myAgentsTotal: 0,
      mySkills: [],
      mySkillsTotal: 0,
      myNotes: [],
      myNotesTotal: 0,
      // Clear share/install state
      shareDialogOpen: false,
      shareMode: "agent" as ShareMode,
      shareAgentId: null,
      shareStep: "form",
      shareLoading: false,
      shareError: null,
      shareResult: null,
      installPopoverOpen: false,
      installItemType: null,
      installSkill: null,
      installNote: null,
      installLoading: false,
      installResult: null,
    });
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab, searchQuery: "", selectedAgentId: null });
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

  // ── Share actions ──

  openShareDialog: (agentId, folderName, name, description) => {
    set({
      shareDialogOpen: true,
      shareMode: "agent",
      shareAgentId: agentId,
      shareFolderName: folderName,
      shareAgentName: name,
      shareAgentDesc: description,
      shareStep: "form",
      shareLoading: false,
      shareError: null,
      localSkills: [],
      localNotes: [],
      selectedSkillNames: new Set(),
      selectedNoteIds: new Set(),
      shareResult: null,
    });
  },

  openShareSkillDialog: (folderName) => {
    set({
      shareDialogOpen: true,
      shareMode: "skill",
      shareAgentId: null,
      shareFolderName: folderName,
      shareAgentName: "",
      shareAgentDesc: "",
      shareStep: "form",
      shareLoading: false,
      shareError: null,
      localSkills: [],
      localNotes: [],
      selectedSkillNames: new Set(),
      selectedNoteIds: new Set(),
      shareResult: null,
    });
  },

  closeShareDialog: () => {
    set({
      shareDialogOpen: false,
      shareMode: "agent",
      shareAgentId: null,
      shareFolderName: "",
      shareAgentName: "",
      shareAgentDesc: "",
      shareStep: "form",
      shareLoading: false,
      shareError: null,
      localSkills: [],
      localNotes: [],
      selectedSkillNames: new Set(),
      selectedNoteIds: new Set(),
      shareResult: null,
    });
  },

  loadLocalContent: async (folderName, agentId) => {
    try {
      const skillsOnly = get().shareMode === "skill";
      const [skills, notes] = await Promise.all([
        listSkills(folderName).catch(() => [] as SkillMetadata[]),
        skillsOnly
          ? Promise.resolve([] as MemoryNote[])
          : listMemoryNotes(agentId).catch(() => [] as MemoryNote[]),
      ]);
      const allSkillNames = new Set(skills.filter((s) => s.source === "agent").map((s) => s.name));
      const allNoteIds = new Set(notes.map((n) => n.id));
      set({
        localSkills: skills.filter((s) => s.source === "agent"),
        localNotes: notes,
        selectedSkillNames: allSkillNames,
        selectedNoteIds: allNoteIds,
      });
    } catch (e) {
      logger.debug("Failed to load local content for sharing:", e);
    }
  },

  toggleSkillSelection: (name) => {
    const current = new Set(get().selectedSkillNames);
    if (current.has(name)) current.delete(name);
    else current.add(name);
    set({ selectedSkillNames: current });
  },

  toggleNoteSelection: (id) => {
    const current = new Set(get().selectedNoteIds);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    set({ selectedNoteIds: current });
  },

  toggleAllSkills: (selected) => {
    if (selected) {
      set({ selectedSkillNames: new Set(get().localSkills.map((s) => s.name)) });
    } else {
      set({ selectedSkillNames: new Set() });
    }
  },

  toggleAllNotes: (selected) => {
    if (selected) {
      set({ selectedNoteIds: new Set(get().localNotes.map((n) => n.id)) });
    } else {
      set({ selectedNoteIds: new Set() });
    }
  },

  setShareAgentName: (name) => set({ shareAgentName: name }),
  setShareAgentDesc: (desc) => set({ shareAgentDesc: desc }),

  executeShare: async () => {
    const {
      shareMode, shareAgentName, shareAgentDesc, shareAgentId, shareFolderName, activeTab,
      selectedSkillNames, selectedNoteIds, localSkills, localNotes,
    } = get();
    set({ shareLoading: true, shareError: null });
    try {
      let agentIdForSharing: string | null = null;

      // 1. Share agent (only in agent mode)
      if (shareMode === "agent") {
        // Read persona files to include with agent
        let persona: PersonaData | undefined;
        try {
          const files = await readPersonaFiles(shareFolderName);
          if (files.identity || files.soul || files.user || files.agents) {
            persona = {
              identity: files.identity,
              soul: files.soul,
              user_context: files.user,
              agents: files.agents,
            };
          }
        } catch (e) {
          logger.debug("Failed to read persona files for sharing:", e);
        }
        const sharedAgent = await hubShareAgent(shareAgentName, shareAgentDesc, shareAgentId || undefined, persona);
        agentIdForSharing = sharedAgent.id;
      }

      // 2. Share selected skills
      let skillsShared = 0;
      if (selectedSkillNames.size > 0) {
        const skillItems: ShareSkillItem[] = [];
        for (const name of selectedSkillNames) {
          const meta = localSkills.find((s) => s.name === name);
          if (!meta) continue;
          try {
            const content = await readSkill(shareFolderName, name);
            skillItems.push({
              name,
              description: meta.description || "",
              body: content.raw_content,
            });
          } catch (e) {
            logger.debug(`Failed to read skill ${name}:`, e);
          }
        }
        if (skillItems.length > 0) {
          await hubShareSkills(agentIdForSharing, skillItems);
          skillsShared = skillItems.length;
        }
      }

      // 3. Share selected notes (only in agent mode)
      let notesShared = 0;
      if (shareMode === "agent" && selectedNoteIds.size > 0) {
        const noteItems: ShareNoteItem[] = [];
        for (const id of selectedNoteIds) {
          const note = localNotes.find((n) => n.id === id);
          if (!note) continue;
          noteItems.push({
            title: note.title,
            note_type: "",
            tags: [],
            body: note.content,
          });
        }
        if (noteItems.length > 0) {
          await hubShareNotes(agentIdForSharing, noteItems);
          notesShared = noteItems.length;
        }
      }

      if (activeTab === "mine") {
        await get().loadMyShares();
      } else if (shareMode === "agent" && activeTab === "agents") {
        await get().loadAgents(0);
      } else if (shareMode === "skill" && activeTab === "skills") {
        await get().loadSkills(0);
      }

      set({
        shareLoading: false,
        shareStep: "result",
        shareResult: { success: true, agentId: agentIdForSharing ?? undefined, skillsShared, notesShared },
      });
    } catch (e) {
      set({
        shareLoading: false,
        shareError: toErrorMessage(e),
        shareStep: "result",
        shareResult: { success: false, skillsShared: 0, notesShared: 0, error: toErrorMessage(e) },
      });
    }
  },

  // ── Install actions ──

  openInstallSkill: (skill) => {
    set({ installPopoverOpen: true, installItemType: "skill", installSkill: skill, installNote: null, installResult: null });
  },

  openInstallNote: (note) => {
    set({ installPopoverOpen: true, installItemType: "note", installNote: note, installSkill: null, installResult: null });
  },

  openInstallAgent: () => {
    set({ installPopoverOpen: true, installItemType: "agent", installSkill: null, installNote: null, installResult: null });
  },

  closeInstall: () => {
    set({ installPopoverOpen: false, installItemType: null, installSkill: null, installNote: null, installLoading: false, installResult: null });
  },

  executeInstallSkill: async (folderName, skill) => {
    set({ installLoading: true });
    const result: InstallResult = { installed: [], skipped: [], errors: [] };
    try {
      const existing = await listSkills(folderName);
      if (existing.some((s) => s.name === skill.skill_name)) {
        result.skipped.push(skill.skill_name);
      } else {
        await createSkill(folderName, skill.skill_name);
        await updateSkill(folderName, skill.skill_name, skill.body);
        result.installed.push(skill.skill_name);
      }
    } catch (e) {
      logger.debug(`Failed to install skill ${skill.skill_name}:`, e);
      result.errors.push(skill.skill_name);
    }
    set({ installLoading: false, installResult: result });
    return result;
  },

  executeInstallNote: async (agentId, note) => {
    set({ installLoading: true });
    const result: InstallResult = { installed: [], skipped: [], errors: [] };
    try {
      await createMemoryNote(agentId, note.title, note.body);
      result.installed.push(note.title);
    } catch (e) {
      logger.debug(`Failed to install note ${note.title}:`, e);
      result.errors.push(note.title);
    }
    set({ installLoading: false, installResult: result });
    return result;
  },

  executeInstallBulk: async (folderName, agentId) => {
    const { agentSkills, agentNotes } = get();
    set({ installLoading: true });
    const result: InstallResult = { installed: [], skipped: [], errors: [] };

    // Install skills
    let existingSkills: SkillMetadata[] = [];
    try { existingSkills = await listSkills(folderName); } catch { /* empty */ }
    const existingNames = new Set(existingSkills.map((s) => s.name));

    for (const skill of agentSkills) {
      try {
        if (existingNames.has(skill.skill_name)) {
          result.skipped.push(skill.skill_name);
        } else {
          await createSkill(folderName, skill.skill_name);
          await updateSkill(folderName, skill.skill_name, skill.body);
          result.installed.push(skill.skill_name);
        }
      } catch {
        result.errors.push(skill.skill_name);
      }
    }

    // Install notes
    for (const note of agentNotes) {
      try {
        await createMemoryNote(agentId, note.title, note.body);
        result.installed.push(note.title);
      } catch {
        result.errors.push(note.title);
      }
    }

    set({ installLoading: false, installResult: result });
    return result;
  },

  hireAgent: async (name, description) => {
    const { selectedAgentId, agents, myAgents, agentSkills, agentNotes } = get();
    try {
      // Create new local agent
      const folderName = name.replace(/\s+/g, "-").toLowerCase();
      const newAgent = await createAgent({
        folder_name: folderName,
        name,
        description: description || undefined,
      });

      // Write persona files if available
      const sharedAgent = agents.find((a) => a.id === selectedAgentId)
        ?? myAgents.find((a) => a.id === selectedAgentId);
      try {
        await writePersonaFiles(newAgent.folder_name, buildHiredPersona(name, description, sharedAgent));
      } catch (e) {
        logger.debug("Failed to write persona files:", e);
      }

      // Install all skills and notes
      const result: InstallResult = { installed: [], skipped: [], errors: [] };

      for (const skill of agentSkills) {
        try {
          await createSkill(newAgent.folder_name, skill.skill_name);
          await updateSkill(newAgent.folder_name, skill.skill_name, skill.body);
          result.installed.push(skill.skill_name);
        } catch {
          result.errors.push(skill.skill_name);
        }
      }

      for (const note of agentNotes) {
        try {
          await createMemoryNote(newAgent.id, note.title, note.body);
          result.installed.push(note.title);
        } catch {
          result.errors.push(note.title);
        }
      }

      await useAgentStore.getState().loadAgents();

      return result;
    } catch (e) {
      logger.debug("Failed to hire agent:", e);
      return { installed: [], skipped: [], errors: [toErrorMessage(e)] };
    }
  },

  // ── My shares ──

  loadMyShares: async () => {
    const userId = get().userId;
    if (!userId) return;
    set({ myLoading: true });
    try {
      const [agents, skills, notes] = await Promise.all([
        hubListAgents(undefined, 50, 0, userId),
        hubListSkills(undefined, undefined, 50, 0, userId),
        hubListNotes(undefined, undefined, 50, 0, userId),
      ]);
      set({
        myAgents: agents.items,
        myAgentsTotal: agents.total,
        mySkills: skills.items,
        mySkillsTotal: skills.total,
        myNotes: notes.items,
        myNotesTotal: notes.total,
        myLoading: false,
      });
    } catch (e) {
      set({ myLoading: false, error: toErrorMessage(e) });
    }
  },

  // ── Delete ──

  deleteSharedAgent: async (id) => {
    try {
      await hubDeleteAgent(id);
      const { activeTab } = get();
      if (activeTab === "mine") get().loadMyShares();
      else get().loadAgents(0);
      return true;
    } catch (e) {
      set({ error: toErrorMessage(e) });
      return false;
    }
  },

  deleteSharedSkill: async (id) => {
    try {
      await hubDeleteSkill(id);
      const { activeTab } = get();
      if (activeTab === "mine") get().loadMyShares();
      else get().loadSkills(0);
      return true;
    } catch (e) {
      set({ error: toErrorMessage(e) });
      return false;
    }
  },

  deleteSharedNote: async (id) => {
    try {
      await hubDeleteNote(id);
      const { activeTab } = get();
      if (activeTab === "mine") get().loadMyShares();
      else get().loadNotes(0);
      return true;
    } catch (e) {
      set({ error: toErrorMessage(e) });
      return false;
    }
  },
}));
