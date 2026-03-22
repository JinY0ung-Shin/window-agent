/**
 * Heartbeat Service
 *
 * Periodic memory maintenance inspired by OpenClaw's HEARTBEAT.md.
 * Runs every 30 minutes while a session is active.
 *
 * Key design decisions:
 * - No LLM calls (pure mechanical processing)
 * - Confidence decay is compute-on-read (no note mutation)
 * - Auto-archive notes below threshold
 * - HEARTBEAT.md is optional (no-op if absent)
 */

import { emitLifecycleEvent, onLifecycleEvent } from "./lifecycleEvents";
import { vaultListNotesWithDecay, vaultArchiveNote } from "./commands/vaultCommands";
import { readAgentFile } from "./tauriCommands";
import { logger } from "./logger";

// ── Types ────────────────────────────────────────────

interface HeartbeatConfig {
  lambda: number;
  minConfidence: number;
  staleDaysThreshold: number;
  autoArchiveBelow: number;
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  lambda: 0.01,
  minConfidence: 0.1,
  staleDaysThreshold: 30,
  autoArchiveBelow: 0.15,
};

// ── State ────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const activeTimers = new Map<string, ReturnType<typeof setInterval>>();
const agentFolders = new Map<string, string>(); // agentId → folderName

// ── Public API ───────────────────────────────────────

export function startHeartbeat(agentId: string, folderName: string): void {
  if (activeTimers.has(agentId)) return;

  agentFolders.set(agentId, folderName);

  const timer = setInterval(async () => {
    emitLifecycleEvent({ type: "heartbeat:tick", agentId });
    await runHeartbeat(agentId, folderName);
  }, HEARTBEAT_INTERVAL_MS);

  activeTimers.set(agentId, timer);
}

export function stopHeartbeat(agentId: string): void {
  const timer = activeTimers.get(agentId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(agentId);
    agentFolders.delete(agentId);
  }
}

// ── Heartbeat Logic ──────────────────────────────────

async function runHeartbeat(agentId: string, folderName: string): Promise<void> {
  const config = await loadHeartbeatConfig(folderName);
  if (!config) return; // HEARTBEAT.md absent → skip

  try {
    // Query notes with computed decay (no mutation)
    const notes = await vaultListNotesWithDecay(
      agentId,
      null,
      config.lambda,
      config.minConfidence,
      config.staleDaysThreshold,
    );

    // Auto-archive notes below threshold
    const archiveCandidates = notes.filter(
      (n) => n.effectiveConfidence < config.autoArchiveBelow,
    );
    for (const note of archiveCandidates) {
      try {
        await vaultArchiveNote(note.id, agentId);
      } catch (e) {
        logger.debug(`[heartbeat] Archive note ${note.id} failed`, e);
      }
    }

    // Log stale warnings
    const staleNotes = notes.filter((n) => n.isStale);
    if (staleNotes.length > 0) {
      logger.warn(
        `[heartbeat] ${agentId}: ${staleNotes.length} stale note(s) (>${config.staleDaysThreshold} days)`,
      );
    }

    if (archiveCandidates.length > 0) {
      logger.info(
        `[heartbeat] ${agentId}: auto-archived ${archiveCandidates.length} note(s) below confidence ${config.autoArchiveBelow}`,
      );
    }
  } catch (e) {
    logger.warn("[heartbeat] tick failed:", e);
  }
}

// ── Config Parsing ───────────────────────────────────

async function loadHeartbeatConfig(folderName: string): Promise<HeartbeatConfig | null> {
  try {
    const content = await readAgentFile(folderName, "HEARTBEAT.md");
    if (!content) return null;
    return parseHeartbeatConfig(content);
  } catch (e) {
    logger.debug("[heartbeat] HEARTBEAT.md not found, skipping", e);
    return null;
  }
}

function parseHeartbeatConfig(content: string): HeartbeatConfig {
  const config = { ...DEFAULT_CONFIG };

  const getValue = (key: string): number | null => {
    const match = content.match(new RegExp(`-\\s*${key}:\\s*([\\d.]+)`));
    return match ? parseFloat(match[1]) : null;
  };

  config.lambda = getValue("lambda") ?? config.lambda;
  config.minConfidence = getValue("min_confidence") ?? config.minConfidence;
  config.staleDaysThreshold = getValue("days_threshold") ?? config.staleDaysThreshold;
  config.autoArchiveBelow = getValue("auto_archive_below") ?? config.autoArchiveBelow;

  return config;
}

// ── Lifecycle Integration ────────────────────────────

let lifecycleUnsubscribe: (() => void) | null = null;

/**
 * Register heartbeat lifecycle listeners.
 * Call once during app initialization.
 */
export function registerHeartbeatLifecycle(): void {
  if (lifecycleUnsubscribe) return; // Already registered

  lifecycleUnsubscribe = onLifecycleEvent(async (event) => {
    if (event.type === "session:start") {
      // Lazy-resolve folderName from agentStore
      const { useAgentStore } = await import("../stores/agentStore");
      const agent = useAgentStore.getState().agents.find((a) => a.id === event.agentId);
      if (agent) {
        startHeartbeat(event.agentId, agent.folder_name);
      }
    }
    if (event.type === "session:end") {
      stopHeartbeat(event.agentId);
    }
  });
}
