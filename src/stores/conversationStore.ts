import { create } from "zustand";
import type { Conversation, ChatMessage } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { readToolConfig } from "../services/nativeToolRegistry";
import { consolidateConversation, recoverPendingConsolidations } from "../services/consolidationService";
import {
  endPreviousSession,
  loadAgentContext,
  onConversationSelected,
  type AgentContextDeps,
  type OnConversationSelectedDeps,
} from "../services/conversationLifecycle";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useVaultStore } from "./vaultStore";
import { useDebugStore } from "./debugStore";
import { useSkillStore } from "./skillStore";
import { useSummaryStore } from "./summaryStore";
import { useMessageStore } from "./messageStore";
import { resetTransientChatState, resetChatContext } from "./resetHelper";
import { useStreamStore, unshelveStream, getCachedStreamContent } from "./streamStore";
import { useTeamStore } from "./teamStore";
import { logger } from "../services/logger";

interface ConversationState {
  conversations: Conversation[];
  currentConversationId: string | null;

  // Learning mode state (single owner)
  currentLearningMode: boolean;
  draftLearningMode: boolean;
  learningModeWarning: boolean;
  getCurrentLearningMode: () => boolean;
  toggleLearningMode: () => Promise<void>;
  resetLearningModeState: () => void;
  dismissLearningModeWarning: () => void;

  // Consolidated memory
  consolidatedMemory: string | null;
  loadConsolidatedMemory: (agentId: string) => Promise<void>;
  triggerConsolidation: (conversationId: string, agentId: string) => void;
  initConsolidationRecovery: () => void;

  dmConversations: () => Conversation[];
  teamConversations: () => Conversation[];
  getConversationsByTeam: () => Record<string, Conversation[]>;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<{ messages: ChatMessage[] }>;
  createNewConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  setCurrentConversationId: (id: string | null) => void;
  openAgentChat: (agentId: string) => Promise<void>;
  openTeamChat: (teamId: string, leaderAgentId: string) => Promise<void>;
  clearAgentChat: (agentId: string) => Promise<void>;
  startNewAgentConversation: (agentId: string) => Promise<void>;
}

/** Build AgentContextDeps from live stores. */
function buildAgentContextDeps(): AgentContextDeps {
  return {
    selectAgent: (id) => useAgentStore.getState().selectAgent(id),
    findAgent: (id) => useAgentStore.getState().agents.find((a) => a.id === id),
    loadMemoryNotes: (id) => useMemoryStore.getState().loadNotes(id),
    loadVaultNotes: (id) => useVaultStore.getState().loadNotes(id),
    loadSkills: (folder) => useSkillStore.getState().loadSkills(folder),
    restoreActiveSkills: (folder, skills) => useSkillStore.getState().restoreActiveSkills(folder, skills),
  };
}

/** Build full OnConversationSelectedDeps from live stores + the conversation store's set/get. */
function buildSelectionDeps(
  get: () => ConversationState,
  set: (partial: Partial<ConversationState>) => void,
): OnConversationSelectedDeps {
  return {
    commands: {
      getConversationDetail: cmds.getConversationDetail,
      getMessages: cmds.getMessages,
    },
    agentContext: buildAgentContextDeps(),
    messageSync: {
      setMessages: (messages) => useMessageStore.setState({ messages }),
    },
    summarySync: {
      loadSummary: (summary, upTo) => useSummaryStore.getState().loadSummary(summary, upTo),
    },
    debug: {
      loadLogs: (id) => useDebugStore.getState().loadLogs(id),
    },
    consolidatedMemory: {
      loadConsolidatedMemory: (agentId) => get().loadConsolidatedMemory(agentId),
    },
    setLearningMode: (value) => set({ currentLearningMode: value }),
    getCurrentConversationId: () => get().currentConversationId,
  };
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  currentConversationId: null,

  // Learning mode
  currentLearningMode: false,
  draftLearningMode: false,
  learningModeWarning: false,

  // Computed getters
  dmConversations: () => get().conversations.filter((c) => !c.team_id),
  teamConversations: () => get().conversations.filter((c) => !!c.team_id),
  getConversationsByTeam: () => {
    const map: Record<string, Conversation[]> = {};
    for (const conv of get().conversations) {
      if (conv.team_id) {
        if (!map[conv.team_id]) map[conv.team_id] = [];
        map[conv.team_id].push(conv);
      }
    }
    return map;
  },

  // Consolidated memory
  consolidatedMemory: null,

  loadConsolidatedMemory: async (agentId: string) => {
    try {
      const content = await cmds.readConsolidatedMemory(agentId);
      set({ consolidatedMemory: content ?? null });
    } catch (e) {
      logger.debug("Consolidated memory unavailable", e);
      set({ consolidatedMemory: null });
    }
  },

  triggerConsolidation: (conversationId: string, agentId: string) => {
    // Fire and forget — don't block UI
    consolidateConversation(conversationId, agentId)
      .then(() => {
        // Reload consolidated memory after consolidation completes
        get().loadConsolidatedMemory(agentId);
      })
      .catch((e) => logger.debug("Background consolidation failed", e));
  },

  initConsolidationRecovery: () => {
    recoverPendingConsolidations().catch((e) => logger.debug("Consolidation recovery failed", e));
  },

  getCurrentLearningMode: () => {
    const { currentConversationId, currentLearningMode, draftLearningMode } = get();
    return currentConversationId ? currentLearningMode : draftLearningMode;
  },

  toggleLearningMode: async () => {
    const { currentConversationId, currentLearningMode, draftLearningMode } = get();
    const wantEnable = currentConversationId ? !currentLearningMode : !draftLearningMode;

    // Check if write_file is available for the selected agent before enabling
    if (wantEnable) {
      const agent = useAgentStore.getState().agents.find(
        (a) => a.id === useAgentStore.getState().selectedAgentId,
      );
      if (agent) {
        try {
          const config = await readToolConfig(agent.folder_name);
          const entry = config?.native?.write_file;
          if (entry && (!entry.enabled || entry.tier === "deny")) {
            // write_file is disabled/deny — cannot use learning mode
            set({ learningModeWarning: true });
            return;
          }
        } catch (e) { logger.debug("Tool config unreadable for learning mode check", e); }
      }
    }

    set({ learningModeWarning: false });

    if (currentConversationId) {
      const newValue = !currentLearningMode;
      try {
        await cmds.setLearningMode(currentConversationId, newValue);
        set({ currentLearningMode: newValue });
      } catch (e) {
        logger.debug("Failed to persist learning mode, state unchanged", e);
      }
    } else {
      set({ draftLearningMode: !draftLearningMode });
    }
  },

  resetLearningModeState: () => set({ currentLearningMode: false, draftLearningMode: false, learningModeWarning: false, consolidatedMemory: null }),

  dismissLearningModeWarning: () => set({ learningModeWarning: false }),

  setCurrentConversationId: (id) => set({ currentConversationId: id }),

  loadConversations: async () => {
    const conversations = await cmds.getConversations();
    set({ conversations });
  },

  selectConversation: async (id) => {
    // End the previous session (lifecycle event + consolidation)
    endPreviousSession(
      get().currentConversationId,
      get().conversations,
      { triggerConsolidation: get().triggerConsolidation },
      id,
    );

    set({ currentConversationId: id, draftLearningMode: false, learningModeWarning: false, consolidatedMemory: null });
    resetTransientChatState();

    // Delegate the full side-effect chain to the lifecycle helper
    const result = await onConversationSelected(id, buildSelectionDeps(get, set));

    // Restore in-flight stream: if a background stream was running for this
    // conversation, re-inject the pending message so flushDelta can resume
    // updating it with streaming deltas.
    const shelved = unshelveStream(id);
    if (shelved) {
      const pending: ChatMessage = {
        id: shelved.msgId,
        type: "agent",
        content: getCachedStreamContent(shelved.msgId),
        status: "streaming",
        requestId: shelved.requestId,
      };
      useMessageStore.setState((state) => ({
        messages: [...state.messages, pending],
      }));
      useStreamStore.setState({
        activeRun: {
          requestId: shelved.requestId,
          conversationId: id,
          targetMessageId: shelved.msgId,
          status: "streaming",
        },
      });
    }

    return result;
  },

  createNewConversation: () => {
    endPreviousSession(
      get().currentConversationId,
      get().conversations,
      { triggerConsolidation: get().triggerConsolidation },
    );
    resetChatContext();
  },

  deleteConversation: async (id) => {
    // Emit session:end if deleting the active conversation
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      endPreviousSession(id, get().conversations, { triggerConsolidation: () => {} });
      resetChatContext();
    }
    await cmds.deleteConversation(id);
    await get().loadConversations();
  },

  openAgentChat: async (agentId) => {
    const { conversations, currentConversationId } = get();

    // Guard: if the current conversation already belongs to this agent, skip
    // re-selection to preserve in-flight streaming state (messages, activeRun)
    // that would be lost by resetTransientChatState() inside selectConversation().
    if (currentConversationId) {
      const currentConv = conversations.find((c) => c.id === currentConversationId);
      if (currentConv) {
        // Conversation is in the list — check agent match
        if (currentConv.agent_id === agentId && !currentConv.team_id) return;
      } else if (!useTeamStore.getState().selectedTeamId) {
        // Optimistic new DM conversation not yet in the list (loadConversations
        // hasn't run). Fall back to selectedAgentId which is set when the
        // conversation was created. Only apply this for DMs — if a team is
        // selected, the current conversation is a team chat and clicking the
        // leader agent should open their DM instead.
        if (useAgentStore.getState().selectedAgentId === agentId) return;
      }
    }

    // Find the most recent conversation for this agent (conversations are sorted by updated_at DESC)
    const agentConv = conversations.find((c) => c.agent_id === agentId && !c.team_id);

    if (agentConv) {
      await get().selectConversation(agentConv.id);
    } else {
      endPreviousSession(
        get().currentConversationId,
        conversations,
        { triggerConsolidation: get().triggerConsolidation },
      );
      // No conversation exists — prepare empty DM for this agent
      resetChatContext();
      await get().loadConsolidatedMemory(agentId);
      await loadAgentContext(agentId, buildAgentContextDeps());
    }
  },

  openTeamChat: async (teamId, leaderAgentId) => {
    // Ensure conversations are up-to-date before lookup (prevents race with mount-time load)
    try { await get().loadConversations(); } catch { /* fall back to in-memory list */ }

    const { conversations } = get();
    // Find the most recent conversation for this team
    const teamConv = conversations.find((c) => c.team_id === teamId);

    // Select team early so the UI switches immediately
    useTeamStore.getState().selectTeam(teamId);

    if (teamConv) {
      // Load existing team conversation
      await get().selectConversation(teamConv.id);
    } else {
      endPreviousSession(
        get().currentConversationId,
        conversations,
        { triggerConsolidation: get().triggerConsolidation },
      );
      // Prepare empty chat for this team's leader agent
      resetChatContext();
      // Re-select team after resetChatContext cleared it
      useTeamStore.getState().selectTeam(teamId);
      await get().loadConsolidatedMemory(leaderAgentId);
      await loadAgentContext(leaderAgentId, buildAgentContextDeps());
    }
  },

  clearAgentChat: async (agentId) => {
    const { conversations, currentConversationId } = get();
    // Delete ALL conversations for this agent
    const agentConvs = conversations.filter((c) => c.agent_id === agentId && !c.team_id);

    // Emit session:end if the active conversation is being cleared
    const wasActive = agentConvs.some((c) => c.id === currentConversationId);
    if (wasActive && currentConversationId) {
      endPreviousSession(currentConversationId, conversations, { triggerConsolidation: () => {} });
    }

    await Promise.all(agentConvs.map((c) => cmds.deleteConversation(c.id)));

    await get().loadConversations();

    if (wasActive) {
      // Reset transient state and re-select the cleared agent for empty DM
      set({ currentConversationId: null });
      get().resetLearningModeState();
      resetTransientChatState();
      await loadAgentContext(agentId, buildAgentContextDeps());
    }
    // If clearing a non-active agent, don't touch global state at all
  },

  startNewAgentConversation: async (agentId) => {
    endPreviousSession(
      get().currentConversationId,
      get().conversations,
      { triggerConsolidation: get().triggerConsolidation },
    );
    set({ currentConversationId: null });
    get().resetLearningModeState();
    resetTransientChatState();
    await get().loadConsolidatedMemory(agentId);
    await loadAgentContext(agentId, buildAgentContextDeps());
  },
}));
