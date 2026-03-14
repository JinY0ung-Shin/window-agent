import type { ChatMessage, MessageRole } from "./types";
import { MAX_HISTORY_MESSAGES, MAX_CONTEXT_TOKENS } from "../constants";
import { estimateTokens, estimateMessageTokens } from "./tokenEstimator";

export type OpenAIMessage = {
  role: MessageRole;
  content: string;
};

/**
 * Build the message array for the API.
 * When systemPromptTokens is provided, selects messages by token budget.
 * Otherwise falls back to the legacy MAX_HISTORY_MESSAGES limit.
 */
export function buildChatMessages(
  messages: ChatMessage[],
  systemPromptTokens?: number,
  summaryTokens?: number,
): OpenAIMessage[] {
  const completed = messages.filter((m) => m.status === "complete");

  if (systemPromptTokens === undefined) {
    // Legacy fallback
    return completed
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({
        role: (m.type === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
  }

  const budget = MAX_CONTEXT_TOKENS - systemPromptTokens - (summaryTokens ?? 0);
  const apiMessages = completed.map((m) => ({
    role: (m.type === "user" ? "user" : "assistant") as "user" | "assistant",
    content: m.content,
  }));

  let remaining = budget;
  const selected: OpenAIMessage[] = [];
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(apiMessages[i]);
    if (remaining - tokens < 0) break;
    remaining -= tokens;
    selected.unshift(apiMessages[i]);
  }

  // Safety: guarantee at least 1 message
  if (selected.length === 0 && apiMessages.length > 0) {
    selected.push(apiMessages[apiMessages.length - 1]);
  }

  return selected;
}

/**
 * Build the full conversation context: system prompt (with optional summary)
 * and token-budgeted message list.
 */
export function buildConversationContext(params: {
  messages: ChatMessage[];
  summary: string | null;
  baseSystemPrompt: string;
}): { systemPrompt: string; apiMessages: OpenAIMessage[] } {
  const systemPrompt = params.summary
    ? `${params.baseSystemPrompt}\n\n[이전 대화 요약]\n${params.summary}\n\n[최근 대화는 아래에 이어집니다]`
    : params.baseSystemPrompt;

  const systemTokens = estimateTokens(systemPrompt);
  const apiMessages = buildChatMessages(params.messages, systemTokens, 0);

  return { systemPrompt, apiMessages };
}
