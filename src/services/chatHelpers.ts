import type { Attachment, ChatMessage, MemoryNote } from "./types";
import type { VaultNoteSummary } from "./vaultTypes";
import { MAX_HISTORY_MESSAGES, MAX_CONTEXT_TOKENS } from "../constants";
import { i18n } from "../i18n";
import { estimateTokens, estimateMessageTokens } from "./tokenEstimator";
import { buildPromptReadySlice } from "./memoryAdapter";
import { readFileBase64 } from "./commands/chatCommands";

const MAX_MEMORY_TOKENS = 500;
/** Maximum number of images to include in API context (most recent first) */
const MAX_IMAGES_IN_CONTEXT = 5;

// ── Multimodal content types ──

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export type OpenAIMessage = {
  role: string;
  content: string | null | ContentPart[];
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

/**
 * Map a ChatMessage to the OpenAI message format.
 * Handles user, agent (with optional tool_calls), and tool result messages.
 * Note: Image enrichment happens separately in enrichMessagesWithImages().
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

/**
 * Determine the vision detail level for an attachment.
 * Browser screenshots use "low" (85 tokens), user images use "auto".
 */
function detailForAttachment(_att: Attachment, toolName?: string): "low" | "auto" {
  return toolName?.startsWith("browser_") ? "low" : "auto";
}

/**
 * Enrich OpenAI messages with image content by reading files from disk.
 * Only the most recent MAX_IMAGES_IN_CONTEXT images are included.
 * Must be called after buildChatMessages() and before sending to API.
 */
export async function enrichMessagesWithImages(
  apiMessages: OpenAIMessage[],
  sourceMessages: ChatMessage[],
): Promise<OpenAIMessage[]> {
  // Collect indices of messages that have image attachments
  const imageIndices: number[] = [];
  for (let i = 0; i < sourceMessages.length; i++) {
    if (sourceMessages[i].attachments?.some((a) => a.type === "image")) {
      imageIndices.push(i);
    }
  }
  if (imageIndices.length === 0) return apiMessages;

  // Only include the N most recent images
  const recentIndices = new Set(imageIndices.slice(-MAX_IMAGES_IN_CONTEXT));

  const enriched = [...apiMessages];

  for (let ai = 0; ai < enriched.length; ai++) {
    const apiMsg = enriched[ai];

    // Find the corresponding source message by matching tool_call_id or content
    const source = sourceMessages.find((m) => {
      if (apiMsg.tool_call_id && m.tool_call_id) return m.tool_call_id === apiMsg.tool_call_id;
      if (apiMsg.role === "user" && m.type === "user") return m.content === apiMsg.content;
      return false;
    });

    if (!source?.attachments?.length) continue;
    const sourceIdx = sourceMessages.indexOf(source);
    if (!recentIndices.has(sourceIdx)) continue;

    // Load images from disk
    const parts: ContentPart[] = [];
    const textContent = typeof apiMsg.content === "string" ? apiMsg.content : "";
    if (textContent) parts.push({ type: "text", text: textContent });

    for (const att of source.attachments) {
      if (att.type !== "image") continue;
      try {
        const base64 = await readFileBase64(att.path);
        const mime = att.mime || "image/png";
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${mime};base64,${base64}`,
            detail: detailForAttachment(att, source.tool_name),
          },
        });
      } catch {
        // File missing or unreadable — skip silently
      }
    }

    if (parts.length > 1 || (parts.length === 1 && parts[0].type === "image_url")) {
      enriched[ai] = { ...enriched[ai], content: parts };
    }
  }

  return enriched;
}

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
    const rawContent = apiMessages[i].content;
    const contentStr = typeof rawContent === "string" ? rawContent : "";
    const tokens = estimateMessageTokens({ role: apiMessages[i].role, content: contentStr });
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
 * Returns enriched messages with vision images when attachments are present.
 */
export async function buildConversationContext(params: {
  messages: ChatMessage[];
  summary: string | null;
  baseSystemPrompt: string;
  skillsSection?: string;
  credentialsSection?: string;
  bootContent?: string | null;
  memoryNotes?: MemoryNote[];
  vaultNotes?: VaultNoteSummary[];
  workspacePath?: string;
  learningMode?: boolean;
  consolidatedMemory?: string | null;
}): Promise<{ systemPrompt: string; apiMessages: OpenAIMessage[] }> {
  let systemPrompt = params.baseSystemPrompt;

  // Boot content goes right after the base system prompt
  if (params.bootContent) {
    systemPrompt += `\n\n${i18n.t("prompts:boot.header")}\n${params.bootContent}`;
  }

  // Skills go between persona and memory
  if (params.skillsSection) {
    systemPrompt += `\n\n${params.skillsSection}`;
  }

  // Vault guide: tell the agent about its memory system
  if (params.vaultNotes?.length || params.learningMode || params.consolidatedMemory) {
    const header = i18n.t("prompts:vaultGuide.header");
    const body = i18n.t("prompts:vaultGuide.body");
    systemPrompt += `\n\n${header}\n${body}`;

    // Inject existing categories so the LLM knows what's already in use
    if (params.vaultNotes?.length) {
      const cats = [...new Set(params.vaultNotes.map((n) => n.noteType).filter(Boolean))].sort();
      if (cats.length > 0) {
        systemPrompt += `\nExisting categories: ${cats.join(", ")}`;
      }
    }
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

  // Credentials section (available env vars for run_shell)
  if (params.credentialsSection) {
    systemPrompt += `\n\n${params.credentialsSection}`;
  }

  if (params.summary) {
    systemPrompt += `\n\n${i18n.t("prompts:summary.previousSummary")}\n${params.summary}\n\n${i18n.t("prompts:summary.recentConversation")}`;
  }

  const systemTokens = estimateTokens(systemPrompt);
  const apiMessages = buildChatMessages(params.messages, systemTokens, 0);

  // Enrich messages with vision images from attachments
  const enrichedMessages = await enrichMessagesWithImages(apiMessages, params.messages);

  return { systemPrompt, apiMessages: enrichedMessages };
}
