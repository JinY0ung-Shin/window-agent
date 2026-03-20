/**
 * Lifecycle Event System
 *
 * Frontend-only pub/sub event bus for structured boot sequence
 * and memory lifecycle management. No Tauri backend changes needed.
 *
 * Inspired by OpenClaw's BOOT.md/HEARTBEAT.md lifecycle
 * and Claude Code's SessionStart/SessionEnd/PreCompact hooks.
 */

// ── Event types ──────────────────────────────────────

export type LifecycleEvent =
  | { type: "app:init" }
  | { type: "app:ready" }
  | { type: "agent:boot"; agentId: string; folderName: string }
  | { type: "session:start"; conversationId: string; agentId: string }
  | { type: "session:end"; conversationId: string; agentId: string }
  | { type: "pre-compact"; conversationId: string; agentId: string; tokensUsed: number; tokenLimit: number }
  | { type: "heartbeat:tick"; agentId: string };

import { logger } from "./logger";

export type LifecycleListener = (event: LifecycleEvent) => void | Promise<void>;

// ── Internal state ───────────────────────────────────

const listeners: LifecycleListener[] = [];

// ── Public API ───────────────────────────────────────

/**
 * Register a lifecycle event listener.
 * Returns an unsubscribe function.
 */
export function onLifecycleEvent(listener: LifecycleListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Emit a lifecycle event to all registered listeners.
 * Listeners are invoked asynchronously (fire-and-forget).
 */
export function emitLifecycleEvent(event: LifecycleEvent): void {
  for (const listener of listeners) {
    try {
      const result = listener(event);
      // Swallow async errors to prevent cascading failures
      if (result instanceof Promise) {
        result.catch((e) => logger.warn(`[lifecycle] ${event.type} listener error:`, e));
      }
    } catch (e) {
      logger.warn(`[lifecycle] ${event.type} listener error:`, e);
    }
  }
}
