import { create } from "zustand";
import type { Permission, FolderEntry, ProgramEntry } from "../services/types";
import {
  getPermissions,
  updatePermission as updatePermissionCmd,
  getFolderWhitelist,
  addFolder as addFolderCmd,
  removeFolder as removeFolderCmd,
  getProgramWhitelist,
  addProgram as addProgramCmd,
  removeProgram as removeProgramCmd,
} from "../services/tauriCommands";

interface SettingsState {
  permissions: Permission[];
  folderWhitelist: FolderEntry[];
  programWhitelist: ProgramEntry[];
  selectedAgentId: string | null;
  loading: boolean;
  setSelectedAgentId: (id: string | null) => void;
  fetchPermissions: (agentId: string) => Promise<void>;
  updatePermission: (agentId: string, type: string, level: string) => Promise<void>;
  fetchFolderWhitelist: (agentId: string) => Promise<void>;
  addFolder: (agentId: string, path: string) => Promise<void>;
  removeFolder: (agentIdOrId: string, folderId?: string) => Promise<void>;
  fetchProgramWhitelist: (agentId: string) => Promise<void>;
  addProgram: (agentId: string, program: string) => Promise<void>;
  removeProgram: (agentIdOrId: string, programId?: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  permissions: [],
  folderWhitelist: [],
  programWhitelist: [],
  selectedAgentId: null,
  loading: false,

  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  fetchPermissions: async (agentId) => {
    set({ loading: true });
    const permissions = await getPermissions(agentId);
    set({ permissions, loading: false });
  },

  updatePermission: async (agentId, type, level) => {
    await updatePermissionCmd(agentId, type, level);
    await get().fetchPermissions(agentId);
  },

  fetchFolderWhitelist: async (agentId) => {
    const folderWhitelist = await getFolderWhitelist(agentId);
    set({ folderWhitelist });
  },

  addFolder: async (agentId, path) => {
    await addFolderCmd(agentId, path);
    await get().fetchFolderWhitelist(agentId);
  },

  removeFolder: async (agentIdOrId, folderId?) => {
    // Support both (id) and (agentId, folderId) calling patterns
    const id = folderId || agentIdOrId;
    const agentId = folderId ? agentIdOrId : get().selectedAgentId;
    await removeFolderCmd(id);
    if (agentId) {
      await get().fetchFolderWhitelist(agentId);
    }
  },

  fetchProgramWhitelist: async (agentId) => {
    const programWhitelist = await getProgramWhitelist(agentId);
    set({ programWhitelist });
  },

  addProgram: async (agentId, program) => {
    await addProgramCmd(agentId, program);
    await get().fetchProgramWhitelist(agentId);
  },

  removeProgram: async (agentIdOrId, programId?) => {
    // Support both (id) and (agentId, programId) calling patterns
    const id = programId || agentIdOrId;
    const agentId = programId ? agentIdOrId : get().selectedAgentId;
    await removeProgramCmd(id);
    if (agentId) {
      await get().fetchProgramWhitelist(agentId);
    }
  },
}));
