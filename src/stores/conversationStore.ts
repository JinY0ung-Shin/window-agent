import { create } from "zustand";
import type { Conversation, ChatMessage } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useDebugStore } from "./debugStore";
import { useSkillStore } from "./skillStore";
import { useSummaryStore } from "./summaryStore";
import { useMessageStore } from "./messageStore";
import { resetTransientChatState, resetChatContext } from "./resetHelper";

interface ConversationState {
  conversations: Conversation[];
  currentConversationId: string | null;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<{ messages: ChatMessage[] }>;
  createNewConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  setCurrentConversationId: (id: string | null) => void;
  openAgentChat: (agentId: string) => Promise<void>;
  clearAgentChat: (agentId: string) => Promise<void>;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  currentConversationId: null,

  setCurrentConversationId: (id) => set({ currentConversationId: id }),

  loadConversations: async () => {
    const conversations = await cmds.getConversations();
    set({ conversations });
  },

  selectConversation: async (id) => {
    set({ currentConversationId: id });
    resetTransientChatState();

    const [detail, dbMessages] = await Promise.all([
      cmds.getConversationDetail(id),
      cmds.getMessages(id),
    ]);
    if (get().currentConversationId !== id) return { messages: [] }; // stale guard

    const messages: ChatMessage[] = dbMessages.map((m) => {
      if (m.role === "user") {
        return { id: m.id, dbMessageId: m.id, type: "user" as const, content: m.content, status: "complete" as const };
      }
      if (m.tool_call_id) {
        return {
          id: m.id, dbMessageId: m.id, type: "tool" as const, content: m.content, status: "complete" as const,
          tool_call_id: m.tool_call_id, tool_name: m.tool_name ?? undefined,
        };
      }
      const chatMsg: ChatMessage = { id: m.id, dbMessageId: m.id, type: "agent" as const, content: m.content, status: "complete" as const };
      if (m.tool_name && m.tool_input) {
        try {
          chatMsg.tool_calls = JSON.parse(m.tool_input);
        } catch { /* ignore parse errors */ }
      }
      return chatMsg;
    });

    // Sync messages to messageStore
    useMessageStore.setState({ messages });

    useSummaryStore.getState().loadSummary(detail.summary, detail.summary_up_to_message_id);

    // Sync agent selection and load memory/skills/debug
    if (detail.agent_id) {
      useAgentStore.getState().selectAgent(detail.agent_id);
      useMemoryStore.getState().loadNotes(detail.agent_id);
      const agent = useAgentStore.getState().agents.find((a) => a.id === detail.agent_id);
      if (agent) {
        await useSkillStore.getState().loadSkills(agent.folder_name);
        if (detail.active_skills && Array.isArray(detail.active_skills) && detail.active_skills.length > 0) {
          await useSkillStore.getState().restoreActiveSkills(agent.folder_name, detail.active_skills);
        }
      }
    }
    useDebugStore.getState().loadLogs(id);

    return { messages, summary: detail.summary, summaryUpToMessageId: detail.summary_up_to_message_id };
  },

  createNewConversation: () => {
    resetChatContext();
  },

  deleteConversation: async (id) => {
    await cmds.deleteConversation(id);
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      resetChatContext();
    }
    await get().loadConversations();
  },

  openAgentChat: async (agentId) => {
    const { conversations } = get();
    // Find the most recent conversation for this agent (conversations are sorted by updated_at DESC)
    const agentConv = conversations.find((c) => c.agent_id === agentId);

    if (agentConv) {
      await get().selectConversation(agentConv.id);
    } else {
      // No conversation exists — prepare empty DM for this agent
      resetChatContext();
      useAgentStore.getState().selectAgent(agentId);
      const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
      if (agent) {
        useMemoryStore.getState().loadNotes(agentId);
        await useSkillStore.getState().loadSkills(agent.folder_name);
      }
    }
  },

  clearAgentChat: async (agentId) => {
    const { conversations, currentConversationId } = get();
    // Delete ALL conversations for this agent
    const agentConvs = conversations.filter((c) => c.agent_id === agentId);
    await Promise.all(agentConvs.map((c) => cmds.deleteConversation(c.id)));

    const wasActive = agentConvs.some((c) => c.id === currentConversationId);

    await get().loadConversations();

    if (wasActive) {
      // Reset transient state and re-select the cleared agent for empty DM
      set({ currentConversationId: null });
      resetTransientChatState();
      useAgentStore.getState().selectAgent(agentId);
      const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
      if (agent) {
        useMemoryStore.getState().loadNotes(agentId);
        await useSkillStore.getState().loadSkills(agent.folder_name);
      }
    }
    // If clearing a non-active agent, don't touch global state at all
  },
}));
