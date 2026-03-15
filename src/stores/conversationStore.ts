import { create } from "zustand";
import type { Conversation, ChatMessage } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useDebugStore } from "./debugStore";
import { useSkillStore } from "./skillStore";
import { useSummaryStore } from "./summaryStore";
import { useMessageStore } from "./messageStore";
import { useStreamStore } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useBootstrapStore } from "./bootstrapStore";

interface ConversationState {
  conversations: Conversation[];
  currentConversationId: string | null;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<{ messages: ChatMessage[] }>;
  createNewConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  setCurrentConversationId: (id: string | null) => void;
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

    // Reset transient state on conversation switch
    useMessageStore.setState({ messages: [], inputValue: "" });
    useStreamStore.setState({ activeRun: null });
    useToolRunStore.getState().resetToolState();
    useBootstrapStore.getState().resetBootstrap();
    useSummaryStore.getState().resetSummary();

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
    useSkillStore.getState().clear();
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
    set({ currentConversationId: null });
    useMessageStore.setState({ messages: [], inputValue: "" });
    useStreamStore.setState({ activeRun: null });
    useToolRunStore.getState().resetToolState();
    useBootstrapStore.getState().resetBootstrap();
    useSummaryStore.getState().resetSummary();
    useAgentStore.getState().selectAgent(null);
    useDebugStore.getState().clear();
    useSkillStore.getState().clear();
  },

  deleteConversation: async (id) => {
    await cmds.deleteConversation(id);
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      set({ currentConversationId: null });
      useMessageStore.setState({ messages: [], inputValue: "" });
      useStreamStore.setState({ activeRun: null });
      useSummaryStore.getState().resetSummary();
      useAgentStore.getState().selectAgent(null);
    }
    await get().loadConversations();
  },
}));
