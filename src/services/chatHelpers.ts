import type { ChatMessage, MessageRole } from "./types";
import {
  MAX_HISTORY_MESSAGES,
  DEFAULT_SYSTEM_PROMPT,
} from "../constants";

export type OpenAIMessage = {
  role: MessageRole;
  content: string;
};

/**
 * Build the message array to send to the OpenAI-compatible API.
 * Filters out loading messages, takes the last N, and prepends a system prompt.
 */
export function buildChatMessages(
  messages: ChatMessage[],
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
): OpenAIMessage[] {
  const history: OpenAIMessage[] = messages
    .filter((m) => !m.isLoading)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: (m.type === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

  return [{ role: "system", content: systemPrompt }, ...history];
}
