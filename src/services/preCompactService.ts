/**
 * Pre-Compaction Flush Service
 *
 * Detects when the context window is nearing its model-specific limit
 * and runs digest + consolidation to update consolidated memory.
 *
 * Key design decisions (from Codex code review, round 2):
 * - Generates digest AND consolidates memory (so prompt benefits immediately)
 * - Does NOT write digest_id or consolidated_at to DB
 *   → final end-of-conversation consolidation runs fresh with all messages
 * - Runs BEFORE buildConversationContext so rebuilt context includes fresh memory
 * - Uses model-specific context limits instead of hardcoded MAX_CONTEXT_TOKENS
 */

import { emitLifecycleEvent, onLifecycleEvent } from "./lifecycleEvents";
import { generateDigest, lockedConsolidateMemory } from "./consolidationService";
import { useConversationStore } from "../stores/conversationStore";
import * as cmds from "./tauriCommands";

// Model-specific context window sizes (tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.3-codex": 1000000,
  "gpt-4.1": 1047576,
  "gpt-4.1-mini": 1047576,
  "gpt-4.1-nano": 1047576,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "claude-sonnet-4-5-20250514": 200000,
  "claude-opus-4-5-20250514": 200000,
  "claude-haiku-3-5-20241022": 200000,
};

const DEFAULT_CONTEXT_LIMIT = 128000;
const COMPACTION_THRESHOLD = 0.80;

export function getContextLimit(modelName: string): number {
  if (MODEL_CONTEXT_WINDOWS[modelName]) return MODEL_CONTEXT_WINDOWS[modelName];
  const prefix = Object.keys(MODEL_CONTEXT_WINDOWS).find((k) => modelName.startsWith(k));
  return prefix ? MODEL_CONTEXT_WINDOWS[prefix] : DEFAULT_CONTEXT_LIMIT;
}

export function shouldFlush(totalTokens: number, modelName: string): boolean {
  const limit = getContextLimit(modelName);
  return totalTokens / limit >= COMPACTION_THRESHOLD;
}

// Track which conversations have been flushed (prevent rapid re-flush)
const flushedConversations = new Set<string>();

/**
 * Mid-conversation flush: generates a digest + consolidates memory.
 * Does NOT modify conversation DB fields (digest_id, consolidated_at)
 * so the final end-of-session consolidation still runs fresh.
 */
export async function preCompactFlush(
  conversationId: string,
  agentId: string,
  modelName: string,
  totalTokens: number,
): Promise<void> {
  if (flushedConversations.has(conversationId)) return;

  const limit = getContextLimit(modelName);

  emitLifecycleEvent({
    type: "pre-compact",
    conversationId,
    agentId,
    tokensUsed: totalTokens,
    tokenLimit: limit,
  });

  try {
    const messages = await cmds.getMessages(conversationId);
    if (messages.length < 3) return;

    // Step 1: Generate digest from current conversation state
    const digestContent = await generateDigest(conversationId, agentId, messages);
    if (!digestContent) return;

    // Step 2: Consolidate memory — m(n+1) = F(m(n), digest)
    // Uses per-agent lock to prevent racing with end-of-session consolidation
    const success = await lockedConsolidateMemory(agentId, digestContent);
    if (!success) return; // Lock held by another job — retry next turn

    // Step 3: Reload consolidated memory into store
    await useConversationStore.getState().loadConsolidatedMemory(agentId);

    // Mark as flushed ONLY after full success
    flushedConversations.add(conversationId);
  } catch (e) {
    console.warn("[pre-compact] flush failed:", e);
    // Don't mark as flushed — allow retry on next turn
  }
}

export function resetFlushState(conversationId: string): void {
  flushedConversations.delete(conversationId);
}

// Auto-reset flush state when a session ends
onLifecycleEvent((event) => {
  if (event.type === "session:end") {
    resetFlushState(event.conversationId);
  }
});
