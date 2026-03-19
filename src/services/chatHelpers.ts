import type { ChatMessage, MemoryNote } from "./types";
import type { VaultNoteSummary } from "./vaultTypes";
import { MAX_HISTORY_MESSAGES, MAX_CONTEXT_TOKENS } from "../constants";
import { i18n } from "../i18n";
import { estimateTokens, estimateMessageTokens } from "./tokenEstimator";
import { buildPromptReadySlice } from "./memoryAdapter";

const MAX_MEMORY_TOKENS = 500;

/**
 * Map a ChatMessage to the OpenAI message format.
 * Handles user, agent (with optional tool_calls), and tool result messages.
 */
function mapToOpenAIMessage(m: ChatMessage): OpenAIMessage {
  if (m.type === "tool") {
    return {
      role: "tool",
      content: m.content,
      tool_call_id: m.tool_call_id,
    };
  }
  if (m.type === "agent" && m.tool_calls && m.tool_calls.length > 0) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }
  return {
    role: m.type === "user" ? "user" : "assistant",
    content: m.content,
  };
}

export type OpenAIMessage = {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
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
      .map((m) => mapToOpenAIMessage(m));
  }

  const budget = MAX_CONTEXT_TOKENS - systemPromptTokens - (summaryTokens ?? 0);
  const apiMessages = completed.map((m) => mapToOpenAIMessage(m));

  let remaining = budget;
  const selected: OpenAIMessage[] = [];
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens({ role: apiMessages[i].role, content: apiMessages[i].content ?? "" });
    if (remaining - tokens < 0) break;
    remaining -= tokens;
    selected.unshift(apiMessages[i]);
  }

  // Safety: guarantee at least 1 message
  if (selected.length === 0 && apiMessages.length > 0) {
    selected.push(apiMessages[apiMessages.length - 1]);
  }

  // Ensure tool_call pairs are complete: if the first selected message is a tool
  // result, include all preceding tool results and their parent assistant message
  // to avoid "No tool call found for function call output" API errors.
  while (selected.length > 0 && selected[0].role === "tool") {
    // Find the index of this orphaned tool message in apiMessages
    const orphanIdx = apiMessages.indexOf(selected[0]);
    if (orphanIdx <= 0) {
      // Can't find parent, remove the orphan
      selected.shift();
      continue;
    }
    // Walk backwards to find the assistant message with tool_calls
    let parentIdx = orphanIdx - 1;
    while (parentIdx >= 0 && apiMessages[parentIdx].role === "tool") {
      parentIdx--;
    }
    if (parentIdx >= 0 && apiMessages[parentIdx].tool_calls) {
      // Insert the parent assistant + all tool results between parent and current start
      const toInsert = apiMessages.slice(parentIdx, orphanIdx);
      selected.unshift(...toInsert);
    } else {
      // No valid parent found, remove orphan tool messages
      selected.shift();
    }
  }

  return selected;
}

/**
 * Build the [MEMORY NOTES] section from memory notes, capped at MAX_MEMORY_TOKENS.
 * Most recent notes take priority when truncating.
 */
export function buildMemorySection(notes: MemoryNote[], maxTokens: number = MAX_MEMORY_TOKENS): string {
  if (notes.length === 0) return "";

  // Sort by created_at descending (newest first for priority)
  const sorted = [...notes].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const lines: string[] = [];
  let tokens = 0;
  const headerTokens = estimateTokens("[MEMORY NOTES]\n");

  tokens += headerTokens;
  for (const note of sorted) {
    const line = `- ${note.title}: ${note.content}`;
    const lineTokens = estimateTokens(line + "\n");
    if (tokens + lineTokens > maxTokens) break;
    tokens += lineTokens;
    lines.push(line);
  }

  if (lines.length === 0) return "";
  return `[MEMORY NOTES]\n${lines.join("\n")}`;
}

/**
 * Build the [MEMORY NOTES] section from vault notes, capped at MAX_MEMORY_TOKENS.
 * Uses the same format as buildMemorySection for backward compatibility.
 */
export function buildVaultMemorySection(notes: VaultNoteSummary[], maxTokens?: number): string {
  return buildPromptReadySlice(notes, maxTokens);
}

/**
 * Build the full conversation context: system prompt (with optional summary
 * and memory notes) and token-budgeted message list.
 */
export function buildConversationContext(params: {
  messages: ChatMessage[];
  summary: string | null;
  baseSystemPrompt: string;
  skillsSection?: string;
  bootContent?: string | null;
  memoryNotes?: MemoryNote[];
  vaultNotes?: VaultNoteSummary[];
  workspacePath?: string;
  learningMode?: boolean;
  consolidatedMemory?: string | null;
}): { systemPrompt: string; apiMessages: OpenAIMessage[] } {
  let systemPrompt = params.baseSystemPrompt;

  // Boot content goes right after the base system prompt
  if (params.bootContent) {
    systemPrompt += `\n\n${i18n.t("prompts:boot.header")}\n${params.bootContent}`;
  }

  // Skills go between persona and memory
  if (params.skillsSection) {
    systemPrompt += `\n\n${params.skillsSection}`;
  }

  // Learning mode prompt injection (between skills and memory)
  if (params.learningMode) {
    const header = i18n.t("prompts:learningMode.header");
    const body = i18n.t("prompts:learningMode.body");
    systemPrompt += `\n\n${header}\n${body}`;
  }

  // Memory injection: consolidated memory takes priority over raw notes
  if (params.consolidatedMemory) {
    systemPrompt += `\n\n[CONSOLIDATED MEMORY]\n${params.consolidatedMemory}`;

    // In learning mode, also include raw notes alongside consolidated memory
    if (params.learningMode) {
      const rawMemorySection = params.vaultNotes && params.vaultNotes.length > 0
        ? buildVaultMemorySection(params.vaultNotes, 700)
        : buildMemorySection(params.memoryNotes ?? [], 700);
      if (rawMemorySection) {
        systemPrompt += `\n\n[CURRENT SESSION NOTES]\n${rawMemorySection.replace("[MEMORY NOTES]\n", "")}`;
      }
    }
  } else {
    // Fallback: use raw notes (legacy behavior)
    const memoryMaxTokens = params.learningMode ? 1500 : 500;
    const memorySection = params.vaultNotes && params.vaultNotes.length > 0
      ? buildVaultMemorySection(params.vaultNotes, memoryMaxTokens)
      : buildMemorySection(params.memoryNotes ?? [], memoryMaxTokens);
    if (memorySection) {
      systemPrompt += `\n\n${memorySection}`;
    }
  }

  // Workspace section
  if (params.workspacePath) {
    systemPrompt += `\n\n${i18n.t("prompts:workspace.header")}\n${i18n.t("prompts:workspace.body", { path: params.workspacePath })}`;
  }

  if (params.summary) {
    systemPrompt += `\n\n${i18n.t("prompts:summary.previousSummary")}\n${params.summary}\n\n${i18n.t("prompts:summary.recentConversation")}`;
  }

  const systemTokens = estimateTokens(systemPrompt);
  const apiMessages = buildChatMessages(params.messages, systemTokens, 0);

  return { systemPrompt, apiMessages };
}
