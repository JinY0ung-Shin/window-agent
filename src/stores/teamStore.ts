import { create } from "zustand";
import type { Team, TeamDetail } from "../services/types";
import * as teamCmds from "../services/commands/teamCommands";
import { logger } from "../services/logger";

interface TeamState {
  teams: Team[];
  selectedTeamId: string | null;
  isTeamEditorOpen: boolean;
  editingTeamId: string | null;

  loadTeams: () => Promise<void>;
  createTeam: (
    name: string,
    description: string,
    leaderAgentId: string,
    memberAgentIds?: string[],
  ) => Promise<Team>;
  updateTeam: (
    id: string,
    updates: { name?: string; description?: string; leader_agent_id?: string },
  ) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
  addMember: (teamId: string, agentId: string, role?: string) => Promise<void>;
  removeMember: (teamId: string, agentId: string) => Promise<void>;
  selectTeam: (id: string | null) => void;
  openTeamEditor: (teamId?: string) => void;
  closeTeamEditor: () => void;
  getTeamDetail: (teamId: string) => Promise<TeamDetail>;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  selectedTeamId: null,
  isTeamEditorOpen: false,
  editingTeamId: null,

  loadTeams: async () => {
    try {
      const teams = await teamCmds.listTeams();
      set({ teams });
    } catch (e) {
      logger.error("Failed to load teams:", e);
      set({ teams: [] });
    }
  },

  createTeam: async (name, description, leaderAgentId, memberAgentIds) => {
    const team = await teamCmds.createTeam({
      name,
      description,
      leader_agent_id: leaderAgentId,
      member_agent_ids: memberAgentIds,
    });
    await get().loadTeams();
    return team;
  },

  updateTeam: async (id, updates) => {
    try {
      await teamCmds.updateTeam(id, updates);
      await get().loadTeams();
    } catch (e) {
      logger.error("Failed to update team:", e);
    }
  },

  deleteTeam: async (id) => {
    try {
      await teamCmds.deleteTeam(id);
      const { selectedTeamId } = get();
      if (selectedTeamId === id) {
        set({ selectedTeamId: null });
      }
      await get().loadTeams();
    } catch (e) {
      logger.error("Failed to delete team:", e);
    }
  },

  addMember: async (teamId, agentId, role = "member") => {
    try {
      await teamCmds.addTeamMember(teamId, agentId, role);
    } catch (e) {
      logger.error("Failed to add team member:", e);
    }
  },

  removeMember: async (teamId, agentId) => {
    try {
      await teamCmds.removeTeamMember(teamId, agentId);
    } catch (e) {
      logger.error("Failed to remove team member:", e);
    }
  },

  selectTeam: (id) => set({ selectedTeamId: id }),

  openTeamEditor: (teamId) =>
    set({
      isTeamEditorOpen: true,
      editingTeamId: teamId ?? null,
    }),

  closeTeamEditor: () =>
    set({
      isTeamEditorOpen: false,
      editingTeamId: null,
    }),

  getTeamDetail: async (teamId) => {
    return teamCmds.getTeamDetail(teamId);
  },
}));
