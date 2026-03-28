import { useMessageStore } from "./messageStore";
import { useStreamStore, shelveActiveRun } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useBootstrapStore } from "./bootstrapStore";
import { useSummaryStore } from "./summaryStore";
import { useDebugStore } from "./debugStore";
import { useSkillStore } from "./skillStore";
import { useMemoryStore } from "./memoryStore";
import { useConversationStore } from "./conversationStore";
import { useAgentStore } from "./agentStore";
import { useTeamStore } from "./teamStore";
import { useTeamRunStore } from "./teamRunStore";

/**
 * Level 1: Reset only transient chat state.
 * Keeps agent selection and conversation selection intact.
 */
export function resetTransientChatState() {
  // Preserve in-flight stream info so it can be restored when the user
  // navigates back to the conversation.
  shelveActiveRun();
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
 * Clear team-specific run state (runsById, activeRuns, per-run tool state).
 * Call when leaving team view or switching teams to prevent stale state leaking.
 */
export function resetTeamRunState() {
  useTeamRunStore.getState().clearAll();
  useStreamStore.setState({ runsById: {} });
  // Cancel any pending per-run tool approvals before clearing state,
  // so that waiting executeToolPipeline calls don't resume after navigation.
  const { toolRunStates } = useToolRunStore.getState();
  for (const runId of Object.keys(toolRunStates)) {
    useToolRunStore.getState().resetToolState(runId);
  }
}

/**
 * Level 2: Full reset including conversation and agent selection.
 */
export function resetChatContext() {
  useConversationStore.setState({ currentConversationId: null });
  useConversationStore.getState().resetLearningModeState();
  useAgentStore.getState().selectAgent(null);
  useTeamStore.getState().selectTeam(null);
  resetTransientChatState();
  resetTeamRunState();
}
