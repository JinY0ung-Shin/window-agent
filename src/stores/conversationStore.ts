import { create } from "zustand";
import type { Conversation, ChatMessage } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { readToolConfig } from "../services/nativeToolRegistry";
import { consolidateConversation, recoverPendingConsolidations } from "../services/consolidationService";
import { emitLifecycleEvent } from "../services/lifecycleEvents";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useVaultStore } from "./vaultStore";
import { useDebugStore } from "./debugStore";
import { useSkillStore } from "./skillStore";
import { useSummaryStore } from "./summaryStore";
import { useMessageStore } from "./messageStore";
import { resetTransientChatState, resetChatContext } from "./resetHelper";
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
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<{ messages: ChatMessage[] }>;
  createNewConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  setCurrentConversationId: (id: string | null) => void;
  openAgentChat: (agentId: string) => Promise<void>;
  clearAgentChat: (agentId: string) => Promise<void>;
  startNewAgentConversation: (agentId: string) => Promise<void>;
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

    // Check if memory_note is available for the selected agent before enabling
    if (wantEnable) {
      const agent = useAgentStore.getState().agents.find(
        (a) => a.id === useAgentStore.getState().selectedAgentId,
      );
      if (agent) {
        try {
          const config = await readToolConfig(agent.folder_name);
          const entry = config?.native?.memory_note;
          if (entry && (!entry.enabled || entry.tier === "deny")) {
            // memory_note is disabled/deny — cannot use learning mode
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
    // Trigger consolidation for the previous conversation (fire-and-forget)
    const prevConvId = get().currentConversationId;
    if (prevConvId && prevConvId !== id) {
      const prevConv = get().conversations.find((c) => c.id === prevConvId);
      if (prevConv) {
        emitLifecycleEvent({ type: "session:end", conversationId: prevConvId, agentId: prevConv.agent_id });
        get().triggerConsolidation(prevConvId, prevConv.agent_id);
      }
    }

    set({ currentConversationId: id, draftLearningMode: false, learningModeWarning: false, consolidatedMemory: null });
    resetTransientChatState();

    const [detail, dbMessages] = await Promise.all([
      cmds.getConversationDetail(id),
      cmds.getMessages(id),
    ]);
    if (get().currentConversationId !== id) return { messages: [] }; // stale guard

    const messages: ChatMessage[] = dbMessages
      .filter((m) => !(m.role === "tool" && m.tool_name === "__team_synthesis_context"))
      .map((m) => {
        let chatMsg: ChatMessage;
        if (m.role === "user") {
          chatMsg = { id: m.id, dbMessageId: m.id, type: "user" as const, content: m.content, status: "complete" as const };
        } else if (m.tool_call_id) {
          chatMsg = {
            id: m.id, dbMessageId: m.id, type: "tool" as const, content: m.content, status: "complete" as const,
            tool_call_id: m.tool_call_id, tool_name: m.tool_name ?? undefined,
          };
        } else {
          chatMsg = { id: m.id, dbMessageId: m.id, type: "agent" as const, content: m.content, status: "complete" as const };
          if (m.tool_name && m.tool_input) {
            try {
              chatMsg.tool_calls = JSON.parse(m.tool_input);
            } catch { /* ignore parse errors */ }
          }
        }
        // Map team sender metadata
        if (m.sender_agent_id) {
          chatMsg.senderAgentId = m.sender_agent_id;
          chatMsg.teamRunId = m.team_run_id ?? undefined;
          chatMsg.teamTaskId = m.team_task_id ?? undefined;
          const agent = useAgentStore.getState().agents.find((a) => a.id === m.sender_agent_id);
          if (agent) {
            chatMsg.senderAgentName = agent.name;
            chatMsg.senderAgentAvatar = agent.avatar;
          }
        }
        return chatMsg;
      });

    // Sync messages to messageStore
    useMessageStore.setState({ messages });

    useSummaryStore.getState().loadSummary(detail.summary, detail.summary_up_to_message_id);

    // Sync learning mode from DB
    set({ currentLearningMode: detail.learning_mode ?? false });

    // Load consolidated memory for prompt injection (awaited to ensure it's ready before first send)
    await get().loadConsolidatedMemory(detail.agent_id);

    // Sync agent selection and load memory/skills/debug
    if (detail.agent_id) {
      useAgentStore.getState().selectAgent(detail.agent_id);
      useMemoryStore.getState().loadNotes(detail.agent_id);
      useVaultStore.getState().loadNotes(detail.agent_id);
      const agent = useAgentStore.getState().agents.find((a) => a.id === detail.agent_id);
      if (agent) {
        await useSkillStore.getState().loadSkills(agent.folder_name);
        if (detail.active_skills && Array.isArray(detail.active_skills) && detail.active_skills.length > 0) {
          await useSkillStore.getState().restoreActiveSkills(agent.folder_name, detail.active_skills);
        }
      }
    }
    useDebugStore.getState().loadLogs(id);

    emitLifecycleEvent({ type: "session:start", conversationId: id, agentId: detail.agent_id });

    return { messages, summary: detail.summary, summaryUpToMessageId: detail.summary_up_to_message_id };
  },

  createNewConversation: () => {
    // Trigger consolidation for previous conversation
    const prevConvId = get().currentConversationId;
    if (prevConvId) {
      const prevConv = get().conversations.find((c) => c.id === prevConvId);
      if (prevConv) {
        emitLifecycleEvent({ type: "session:end", conversationId: prevConvId, agentId: prevConv.agent_id });
        get().triggerConsolidation(prevConvId, prevConv.agent_id);
      }
    }
    resetChatContext();
  },

  deleteConversation: async (id) => {
    // Emit session:end if deleting the active conversation
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      const conv = get().conversations.find((c) => c.id === id);
      if (conv) {
        emitLifecycleEvent({ type: "session:end", conversationId: id, agentId: conv.agent_id });
      }
      resetChatContext();
    }
    await cmds.deleteConversation(id);
    await get().loadConversations();
  },

  openAgentChat: async (agentId) => {
    const { conversations } = get();
    // Find the most recent conversation for this agent (conversations are sorted by updated_at DESC)
    const agentConv = conversations.find((c) => c.agent_id === agentId);

    if (agentConv) {
      await get().selectConversation(agentConv.id);
    } else {
      // Trigger consolidation for previous conversation
      const prevConvId = get().currentConversationId;
      if (prevConvId) {
        const prevConv = get().conversations.find((c) => c.id === prevConvId);
        if (prevConv) {
          emitLifecycleEvent({ type: "session:end", conversationId: prevConvId, agentId: prevConv.agent_id });
          get().triggerConsolidation(prevConvId, prevConv.agent_id);
        }
      }
      // No conversation exists — prepare empty DM for this agent
      resetChatContext();
      useAgentStore.getState().selectAgent(agentId);
      await get().loadConsolidatedMemory(agentId);
      const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
      if (agent) {
        useMemoryStore.getState().loadNotes(agentId);
        useVaultStore.getState().loadNotes(agentId);
        await useSkillStore.getState().loadSkills(agent.folder_name);
      }
    }
  },

  clearAgentChat: async (agentId) => {
    const { conversations, currentConversationId } = get();
    // Delete ALL conversations for this agent
    const agentConvs = conversations.filter((c) => c.agent_id === agentId);

    // Emit session:end if the active conversation is being cleared
    const wasActive = agentConvs.some((c) => c.id === currentConversationId);
    if (wasActive && currentConversationId) {
      emitLifecycleEvent({ type: "session:end", conversationId: currentConversationId, agentId });
    }

    await Promise.all(agentConvs.map((c) => cmds.deleteConversation(c.id)));

    await get().loadConversations();

    if (wasActive) {
      // Reset transient state and re-select the cleared agent for empty DM
      set({ currentConversationId: null });
      get().resetLearningModeState();
      resetTransientChatState();
      useAgentStore.getState().selectAgent(agentId);
      const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
      if (agent) {
        useMemoryStore.getState().loadNotes(agentId);
        useVaultStore.getState().loadNotes(agentId);
        await useSkillStore.getState().loadSkills(agent.folder_name);
      }
    }
    // If clearing a non-active agent, don't touch global state at all
  },

  startNewAgentConversation: async (agentId) => {
    // Trigger consolidation for previous conversation
    const prevConvId = get().currentConversationId;
    if (prevConvId) {
      const prevConv = get().conversations.find((c) => c.id === prevConvId);
      if (prevConv) {
        emitLifecycleEvent({ type: "session:end", conversationId: prevConvId, agentId: prevConv.agent_id });
        get().triggerConsolidation(prevConvId, prevConv.agent_id);
      }
    }
    set({ currentConversationId: null });
    get().resetLearningModeState();
    resetTransientChatState();
    useAgentStore.getState().selectAgent(agentId);
    await get().loadConsolidatedMemory(agentId);
    const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
    if (agent) {
      useMemoryStore.getState().loadNotes(agentId);
      useVaultStore.getState().loadNotes(agentId);
      await useSkillStore.getState().loadSkills(agent.folder_name);
    }
  },
}));
