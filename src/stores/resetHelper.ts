import { useMessageStore } from "./messageStore";
import { useStreamStore } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useBootstrapStore } from "./bootstrapStore";
import { useSummaryStore } from "./summaryStore";
import { useDebugStore } from "./debugStore";
import { useSkillStore } from "./skillStore";
import { useMemoryStore } from "./memoryStore";
import { useConversationStore } from "./conversationStore";
import { useAgentStore } from "./agentStore";

/**
 * Level 1: Reset only transient chat state.
 * Keeps agent selection and conversation selection intact.
 */
export function resetTransientChatState() {
  useMessageStore.setState({ messages: [], inputValue: "" });
  useStreamStore.setState({ activeRun: null });
  useToolRunStore.getState().resetToolState();
  useBootstrapStore.getState().resetBootstrap();
  useSummaryStore.getState().resetSummary();
  useDebugStore.getState().clear();
  useSkillStore.getState().clear();
  useMemoryStore.getState().clear();
}

/**
 * Level 2: Full reset including conversation and agent selection.
 */
export function resetChatContext() {
  useConversationStore.setState({ currentConversationId: null });
  useAgentStore.getState().selectAgent(null);
  resetTransientChatState();
}
