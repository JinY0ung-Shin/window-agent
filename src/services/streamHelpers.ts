import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, ToolCall } from "./types";
import * as cmds from "./tauriCommands";
import { useMessageStore } from "../stores/messageStore";
import { useConversationStore } from "../stores/conversationStore";
import { useStreamStore, cacheStreamContent, getCachedStreamContent } from "../stores/streamStore";
import { useBootstrapStore } from "../stores/bootstrapStore";
import { useSummaryStore } from "../stores/summaryStore";
import { useToolRunStore } from "../stores/toolRunStore";
import { getToolTier, type ToolDefinition } from "./toolRegistry";
import { executeToolCalls } from "./toolService";
import { i18n } from "../i18n";
import {
  extractBrowserDomain,
  isBrowserDomainApproved,
  isCredentialBearingTool,
  clearBrowserApprovals,
} from "./browserApprovalService";

// ── Stream event types ────────────────────────────────

export type StreamChunkEvent = {
  request_id: string;
  delta: string;
  reasoning_delta: string | null;
};

export type StreamDoneEvent = {
  request_id: string;
  full_content: string;
  reasoning_content: string | null;
  tool_calls:
    | { id: string; type: string; function: { name: string; arguments: string } }[]
    | null;
  error: string | null;
};

// ── Constants ─────────────────────────────────────────

export const MAX_TOOL_ITERATIONS = 10;

// ── Store accessors (shorthand) ──────────────────────

export const msg = () => useMessageStore.getState();
export const conv = () => useConversationStore.getState();
export const stream = () => useStreamStore.getState();
export const boot = () => useBootstrapStore.getState();
export const summary = () => useSummaryStore.getState();

// ── Helper functions ──────────────────────────────────

export function createPendingMessage(requestId?: string): { msgId: string; msg: ChatMessage } {
  const msgId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    msgId,
    msg: {
      id: msgId,
      type: "agent",
      content: i18n.t("common:loadingMessage"),
      status: "pending",
      requestId,
    },
  };
}

export function updateMessageInList(
  messages: ChatMessage[],
  targetId: string,
  updates: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((m) => (m.id === targetId ? { ...m, ...updates } : m));
}

// ── Workspace path auto-approve ──────────────────────

export function isWorkspacePath(tc: ToolCall, workspacePath: string | undefined): boolean {
  if (!workspacePath) return false;
  if (!["write_file", "delete_file"].includes(tc.name)) return false;
  let p: string | undefined;
  try {
    const args = JSON.parse(tc.arguments);
    p = args?.path;
  } catch { return false; }
  if (!p || typeof p !== "string") return false;
  if (p.includes("..")) return false;
  const normalized = p.startsWith("/") ? p : `${workspacePath}/${p}`;
  const wsSegments = workspacePath.split("/").filter(Boolean);
  const pSegments = normalized.split("/").filter(Boolean);
  return wsSegments.every((seg, i) => pSegments[i] === seg);
}

// ── Stream call executor ─────────────────────────────
// Core streaming pattern: listen for chunks with rAF batching, call API, return done event

export async function executeStreamCall(params: {
  requestId: string;
  msgId: string;
  messages: Record<string, unknown>[];
  systemPrompt: string;
  model: string;
  temperature: number | null;
  thinkingEnabled: boolean;
  thinkingBudget: number | null;
  tools?: object[] | null;
}): Promise<StreamDoneEvent> {
  const {
    requestId, msgId, messages, systemPrompt,
    model, temperature, thinkingEnabled, thinkingBudget, tools,
  } = params;

  let pendingDelta = "";
  let pendingReasoning = "";
  let rafId: number | null = null;

  const flushDelta = () => {
    if (!pendingDelta && !pendingReasoning) return;
    const delta = pendingDelta;
    pendingDelta = "";
    pendingReasoning = "";

    const current = msg().messages;
    const idx = current.findIndex((m: ChatMessage) => m.id === msgId);
    if (idx < 0) {
      // Message not in store (user navigated away). Accumulate content in
      // cache so it can be restored when the user navigates back.
      cacheStreamContent(msgId, getCachedStreamContent(msgId) + delta);
      return;
    }

    const target = current[idx];
    const newContent = target.content === i18n.t("common:loadingMessage") ? delta : target.content + delta;
    const updated = [...current];
    updated[idx] = {
      ...target,
      content: newContent,
      status: "streaming" as const,
    };
    useMessageStore.setState({ messages: updated });
    // Keep cache in sync for potential future navigation
    cacheStreamContent(msgId, newContent);

    const activeRun = stream().activeRun;
    if (activeRun) {
      useStreamStore.setState({ activeRun: { ...activeRun, status: "streaming" } });
    }
  };

  let doneResolve: (v: StreamDoneEvent) => void;
  const donePromise = new Promise<StreamDoneEvent>((r) => { doneResolve = r; });

  const unlistenChunk = await listen<StreamChunkEvent>(
    "chat-stream-chunk",
    (event) => {
      if (event.payload.request_id !== requestId) return;
      pendingDelta += event.payload.delta;
      if (event.payload.reasoning_delta) {
        pendingReasoning += event.payload.reasoning_delta;
      }
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          flushDelta();
          rafId = null;
        });
      }
    },
  );

  const unlistenDone = await listen<StreamDoneEvent>(
    "chat-stream-done",
    (event) => {
      if (event.payload.request_id !== requestId) return;
      doneResolve(event.payload);
    },
  );

  try {
    await cmds.chatCompletionStream({
      messages,
      system_prompt: systemPrompt,
      model,
      temperature,
      thinking_enabled: thinkingEnabled,
      thinking_budget: thinkingBudget,
      request_id: requestId,
      tools: tools && tools.length > 0 ? tools : null,
    });

    const done = await donePromise;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    flushDelta();
    return done;
  } finally {
    unlistenChunk();
    unlistenDone();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }
}

// ── Tool call classification ─────────────────────────

export interface ToolClassification {
  autoTools: ToolCall[];
  confirmTools: ToolCall[];
  denyTools: ToolCall[];
}

export function classifyToolCalls(
  parsedToolCalls: ToolCall[],
  toolDefinitions: ToolDefinition[],
  options?: {
    workspacePath?: string;
    convId?: string;
    autoApproveEnabled?: boolean;
    agentHasCredentials?: boolean;
  },
): ToolClassification {
  const autoTools: ToolCall[] = [];
  const confirmTools: ToolCall[] = [];
  const denyTools: ToolCall[] = [];

  for (const tc of parsedToolCalls) {
    const tier = getToolTier(toolDefinitions, tc.name);
    if (tier === "deny") {
      denyTools.push(tc);
    } else if (tier === "confirm") {
      // Workspace write/delete auto-approve
      if (options?.workspacePath && isWorkspacePath(tc, options.workspacePath)) {
        autoTools.push(tc);
      // Browser tools with already-approved domains skip confirmation
      } else if (
        options?.convId &&
        extractBrowserDomain(tc.name, tc.arguments) &&
        isBrowserDomainApproved(options.convId, extractBrowserDomain(tc.name, tc.arguments))
      ) {
        autoTools.push(tc);
      } else if (options?.autoApproveEnabled && !isCredentialBearingTool(tc, options?.agentHasCredentials ?? false)) {
        autoTools.push(tc);
      } else {
        confirmTools.push(tc);
      }
    } else {
      autoTools.push(tc);
    }
  }

  return { autoTools, confirmTools, denyTools };
}

// ── Tool execution pipeline ──────────────────────────

export async function executeToolPipeline(
  classification: ToolClassification,
  convId: string,
  options?: {
    iterationCount?: number;
    runId?: string;
    onConfirmApproved?: (tools: ToolCall[]) => void;
  },
): Promise<ChatMessage[]> {
  const { autoTools, confirmTools, denyTools } = classification;
  const savedToolMsgs: ChatMessage[] = [];
  const runId = options?.runId;

  // Set initial tool run state (chatFlowStore passes iterationCount; teamChatFlowStore skips)
  if (options?.iterationCount !== undefined) {
    if (confirmTools.length > 0) {
      useToolRunStore.getState().setPending(confirmTools, options.iterationCount, runId);
    } else {
      useToolRunStore.getState().setRunning(runId);
    }
  }

  // Execute denied tools
  for (const tc of denyTools) {
    const saved = await cmds.saveMessage({
      conversation_id: convId,
      role: "tool",
      content: "Tool denied by policy.",
      tool_call_id: tc.id,
      tool_name: tc.name,
    });
    savedToolMsgs.push({
      id: saved.id,
      type: "tool" as const,
      content: "Tool denied by policy.",
      status: "complete" as const,
      tool_call_id: tc.id,
      tool_name: tc.name,
    });
  }

  // Execute auto-approved tools
  if (autoTools.length > 0) {
    useToolRunStore.getState().setRunning(runId);
    const autoResults = await executeToolCalls(autoTools, convId);
    for (const toolMsg of autoResults) {
      const saved = await cmds.saveMessage({
        conversation_id: convId,
        role: "tool",
        content: toolMsg.content,
        tool_call_id: toolMsg.tool_call_id,
        tool_name: toolMsg.tool_name,
      });
      savedToolMsgs.push({ ...toolMsg, id: saved.id, dbMessageId: saved.id });
      // Clear frontend approval cache when browser session is closed
      if (toolMsg.tool_name === "browser_close") clearBrowserApprovals(convId);
    }
  }

  // Execute confirm-tier tools with user approval
  if (confirmTools.length > 0) {
    useToolRunStore.getState().setWaiting(confirmTools, runId);
    const approved = await useToolRunStore.getState().waitForToolApproval(runId);
    if (!approved && useToolRunStore.getState().isRunCancelled(runId)) {
      // Run was cancelled (e.g. user navigated away) — skip rejection messages
      return savedToolMsgs;
    }
    if (approved) {
      options?.onConfirmApproved?.(confirmTools);
      useToolRunStore.getState().setRunning(runId);
      const confirmResults = await executeToolCalls(confirmTools, convId);
      for (const toolMsg of confirmResults) {
        const saved = await cmds.saveMessage({
          conversation_id: convId,
          role: "tool",
          content: toolMsg.content,
          tool_call_id: toolMsg.tool_call_id,
          tool_name: toolMsg.tool_name,
        });
        savedToolMsgs.push({ ...toolMsg, id: saved.id, dbMessageId: saved.id });
        if (toolMsg.tool_name === "browser_close") clearBrowserApprovals(convId);
      }
    } else {
      for (const tc of confirmTools) {
        const saved = await cmds.saveMessage({
          conversation_id: convId,
          role: "tool",
          content: "Tool call rejected by user.",
          tool_call_id: tc.id,
          tool_name: tc.name,
        });
        savedToolMsgs.push({
          id: saved.id,
          type: "tool" as const,
          content: "Tool call rejected by user.",
          status: "complete" as const,
          tool_call_id: tc.id,
          tool_name: tc.name,
        });
      }
    }
  }

  return savedToolMsgs;
}
