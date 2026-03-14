import type { ChatMessage, MessageRole } from "./types";
import { MAX_HISTORY_MESSAGES } from "../constants";

export type OpenAIMessage = {
  role: MessageRole;
  content: string;
};

/**
 * Build the message array for the API.
 * Filters out loading messages and takes the last N.
 * System prompt is handled by the backend.
 */
export function buildChatMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages
    .filter((m) => !m.isLoading)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: (m.type === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));
}
