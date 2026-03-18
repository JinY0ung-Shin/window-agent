import { create } from "zustand";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { buildChatMessages } from "../services/chatHelpers";
import { estimateTokens, estimateMessageTokens } from "../services/tokenEstimator";
import type { ChatMessage } from "../services/types";
import { useConversationStore } from "./conversationStore";
import { MAX_CONTEXT_TOKENS } from "../constants";
import { i18n } from "../i18n";

interface SummaryState {
  currentSummary: string | null;
  summaryUpToMessageId: string | null;
  summaryJobId: string | null;

  setSummary: (summary: string | null, upToMessageId: string | null) => void;
  resetSummary: () => void;
  loadSummary: (summary: string | undefined, upToMessageId: string | undefined) => void;
  maybeGenerateSummary: (
    convId: string,
    baseSystemPrompt: string,
    messages: ChatMessage[],
    loadConversations: () => Promise<void>,
  ) => void;
}

export const useSummaryStore = create<SummaryState>((set, get) => ({
  currentSummary: null,
  summaryUpToMessageId: null,
  summaryJobId: null,

  setSummary: (summary, upToMessageId) =>
    set({ currentSummary: summary, summaryUpToMessageId: upToMessageId }),

  resetSummary: () =>
    set({ currentSummary: null, summaryUpToMessageId: null, summaryJobId: null }),

  loadSummary: (summary, upToMessageId) =>
    set({
      currentSummary: summary ?? null,
      summaryUpToMessageId: upToMessageId ?? null,
    }),

  maybeGenerateSummary: (convId, baseSystemPrompt, messages, _loadConversations) => {
    const allMessages = messages.filter((m) => m.status === "complete");
    const totalTokens = allMessages.reduce(
      (sum, m) => sum + estimateMessageTokens({ role: m.type === "user" ? "user" : "assistant", content: m.content }), 0,
    );

    const { currentSummary, summaryUpToMessageId } = get();

    const systemTokens = estimateTokens(currentSummary
      ? `${baseSystemPrompt}\n\n${i18n.t("prompts:summary.previousSummary")}\n${currentSummary}\n\n${i18n.t("prompts:summary.recentConversation")}`
      : baseSystemPrompt);
    const budget = MAX_CONTEXT_TOKENS - systemTokens;
    if (totalTokens < budget * 0.8) return;

    const selected = buildChatMessages(allMessages, systemTokens, 0);
    const selectedCount = selected.length;
    const excluded = allMessages.slice(0, allMessages.length - selectedCount);
    if (excluded.length === 0) return;

    const currentUpToId = summaryUpToMessageId;
    let deltaStart = 0;
    if (currentUpToId) {
      const checkpointIdx = excluded.findIndex((m) => m.dbMessageId === currentUpToId);
      if (checkpointIdx >= 0) {
        deltaStart = checkpointIdx + 1;
      }
    }
    const newExcluded = excluded.slice(deltaStart);
    if (newExcluded.length === 0) return;

    const jobId = `summary-${Date.now()}`;
    const expectedPrevious = summaryUpToMessageId;
    set({ summaryJobId: jobId });

    const existingSummary = currentSummary || "";
    const toSummarize = newExcluded
      .map((m) => `${m.type === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    (async () => {
      try {
        const settings = useSettingsStore.getState();
        const resp = await cmds.chatCompletion({
          messages: [
            { role: "system", content: i18n.t("prompts:summaryGeneration") },
            { role: "user", content: `${i18n.t("prompts:summary.inputPreviousSummary")}\n${existingSummary}\n\n${i18n.t("prompts:summary.inputNewMessages")}\n${toSummarize}` },
          ],
          system_prompt: "",
          model: settings.modelName,
          thinking_enabled: false,
          thinking_budget: null,
        });

        if (get().summaryJobId !== jobId) return;
        if (useConversationStore.getState().currentConversationId !== convId) return;

        const newSummary = resp.content.trim();
        const lastExcludedMsg = excluded[excluded.length - 1];
        const newUpToId = lastExcludedMsg.dbMessageId;
        if (!newUpToId) return;

        const affected = await cmds.updateConversationSummary(
          convId, newSummary, newUpToId, expectedPrevious ?? null,
        );

        if (affected > 0) {
          set({ currentSummary: newSummary, summaryUpToMessageId: newUpToId });
        }
      } catch {
        // Silently ignore — retry on next turn
      }
    })();
  },
}));
