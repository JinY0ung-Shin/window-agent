/**
 * Memory Consolidation Service
 *
 * Implements the recursive memory consolidation formula:
 *   m(n+1) = F(m(n), d(n))
 *
 * Orchestration flow (all async, non-blocking):
 * 1. Generate digest d(n) from conversation snapshot + tool logs + captured notes
 * 2. Consolidate: m(n+1) = F(m(n), d(n))
 * 3. Archive raw notes from the conversation
 */

import { i18n } from "../i18n";
import { useSettingsStore } from "../stores/settingsStore";
import * as cmds from "./tauriCommands";
import * as vault from "./commands/vaultCommands";
import type { ChatCompletionRequest } from "./commands/apiCommands";
import { chatCompletion } from "./commands/apiCommands";
import { logger } from "./logger";

// ── Per-agent mutex ──
const activeJobs = new Set<string>();

/**
 * Run full consolidation pipeline for a conversation.
 * No-op if: already running for this agent, conversation has < 3 messages, or already consolidated.
 */
export async function consolidateConversation(
  conversationId: string,
  agentId: string,
): Promise<void> {
  // Per-agent mutex
  if (activeJobs.has(agentId)) return;
  activeJobs.add(agentId);

  try {
    const detail = await cmds.getConversationDetail(conversationId);

    // If already fully consolidated, skip
    if (detail.consolidated_at) return;

    // Check minimum messages
    const messages = await cmds.getMessages(conversationId);
    if (messages.length < 3) return;

    // Step 1: Generate digest (if not already done — handles crash recovery)
    let digestContent: string | null = null;
    if (!detail.digest_id) {
      digestContent = await generateDigest(conversationId, agentId, messages);
      if (!digestContent) return;

      // Save digest
      const digestId = await cmds.writeDigest(agentId, conversationId, digestContent);
      await cmds.updateConversationDigest(conversationId, digestId);

      // Notes persist after consolidation — no longer archived automatically.
    } else {
      // Digest already exists but consolidation incomplete — read the digest
      try {
        digestContent = await cmds.readDigest(agentId, conversationId);
      } catch (e) { logger.debug("[consolidation] Digest read failed, proceeding without", e); }
    }

    // Step 2: Consolidate — only mark as consolidated if F succeeds
    if (!digestContent) return; // No digest = cannot consolidate, let recovery retry

    const success = await consolidateMemory(agentId, digestContent);
    if (success) {
      await cmds.updateConversationConsolidated(conversationId);
    }
  } catch (err) {
    logger.error("[consolidation] Failed:", err);
  } finally {
    activeJobs.delete(agentId);
  }
}

/**
 * Generate a digest from conversation messages + tool call logs + captured notes.
 */
export async function generateDigest(
  conversationId: string,
  agentId: string,
  messages: { role: string; content: string }[],
): Promise<string | null> {
  const settings = useSettingsStore.getState();

  // Build conversation text from recent messages
  const recentMessages = messages.slice(-30);
  const conversationText = recentMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  // Collect only vault notes created/modified in this conversation (via source_conversation)
  let capturedNotesText = "";
  try {
    const allNotes = await vault.vaultListNotes(agentId);
    const conversationNotes = allNotes.filter(
      (n) => n.sourceConversation === conversationId,
    );
    if (conversationNotes.length > 0) {
      const noteSummaries = conversationNotes.map(
        (n) => `- ${n.title}: ${n.bodyPreview ?? ""}`,
      );
      capturedNotesText = `\n\n--- VAULT NOTES (this conversation) ---\n${noteSummaries.join("\n")}`;
    }
  } catch (e) { logger.debug("[consolidation] Vault notes fetch failed", e); }

  // Collect vault-scope file tool activity for additional context
  let toolActivity = "";
  try {
    const logs = await cmds.listToolCallLogs(conversationId);
    const vaultLogs = logs.filter((log) => {
      if (log.tool_name !== "write_file" && log.tool_name !== "delete_file") return false;
      try { return JSON.parse(log.tool_input || "{}").scope === "vault"; } catch { return false; }
    });
    if (vaultLogs.length > 0) {
      const logSummaries = vaultLogs.map((log) => {
        try {
          const input = JSON.parse(log.tool_input || "{}");
          return `- ${log.tool_name}: ${input.path || ""}`;
        } catch { return `- ${log.tool_name}`; }
      });
      toolActivity = `\n\n--- VAULT FILE ACTIVITY ---\n${logSummaries.join("\n")}`;
    }
  } catch (e) { logger.debug("[consolidation] Tool call logs fetch failed", e); }

  const systemPrompt = i18n.t("prompts:digest.system");
  const instruction = i18n.t("prompts:digest.instruction", { conversationId });

  const request: ChatCompletionRequest = {
    messages: [
      {
        role: "user",
        content: `${instruction}\n\n--- CONVERSATION ---\n${conversationText}${capturedNotesText}${toolActivity}`,
      },
    ],
    system_prompt: systemPrompt,
    model: settings.modelName,
    temperature: 0,
    thinking_enabled: false,
    thinking_budget: null,
  };

  try {
    const response = await chatCompletion(request);
    return response.content || null;
  } catch (err) {
    logger.error("[consolidation] Digest generation failed:", err);
    return null;
  }
}

/**
 * Lock-guarded wrapper for consolidateMemory.
 * Use this from external callers (e.g., preCompactService) to prevent
 * racing with consolidateConversation on the same agent.
 */
export async function lockedConsolidateMemory(agentId: string, digestContent: string): Promise<boolean> {
  if (activeJobs.has(agentId)) return false; // Another job is running
  activeJobs.add(agentId);
  try {
    return await consolidateMemory(agentId, digestContent);
  } finally {
    activeJobs.delete(agentId);
  }
}

/**
 * Consolidation function F: m(n+1) = F(m(n), d(n))
 * Takes current consolidated memory + actual digest content → merges via LLM.
 */
export async function consolidateMemory(agentId: string, digestContent: string): Promise<boolean> {
  const settings = useSettingsStore.getState();

  const currentMemory = await cmds.readConsolidatedMemory(agentId);

  // Parse current version from memory content
  let version = 1;
  if (currentMemory) {
    const versionMatch = currentMemory.match(/version:\s*(\d+)/);
    if (versionMatch) version = parseInt(versionMatch[1], 10) + 1;
  }

  const systemPrompt = i18n.t("prompts:consolidation.system");
  const instruction = i18n.t("prompts:consolidation.instruction");

  const currentMemoryText = currentMemory || "(No existing memory — this is the first consolidation)";

  const request: ChatCompletionRequest = {
    messages: [
      {
        role: "user",
        content: `${instruction}\n\n--- CURRENT MEMORY ---\n${currentMemoryText}\n\n--- NEW DIGEST ---\n${digestContent}`,
      },
    ],
    system_prompt: systemPrompt,
    model: settings.modelName,
    temperature: 0,
    thinking_enabled: false,
    thinking_budget: null,
  };

  try {
    const response = await chatCompletion(request);
    if (response.content) {
      const now = new Date().toISOString();
      const consolidatedContent = `---\nagent: ${agentId}\nversion: ${version}\nlast_consolidated_at: ${now}\n---\n\n${response.content}`;
      await cmds.writeConsolidatedMemory(agentId, consolidatedContent, version);
      return true;
    }
    return false;
  } catch (err) {
    logger.error("[consolidation] Memory consolidation failed:", err);
    return false;
  }
}

/**
 * Run consolidation for all pending conversations (startup recovery).
 * Handles both "no digest" and "digest done but consolidation incomplete" cases.
 */
export async function recoverPendingConsolidations(): Promise<void> {
  try {
    const pending = await cmds.listPendingConsolidations();
    for (const item of pending) {
      consolidateConversation(item.conversation_id, item.agent_id).catch(() => {});
    }
  } catch (e) {
    logger.debug("[consolidation] Recovery enumeration failed", e);
  }
}
