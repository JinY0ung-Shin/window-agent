// Stream execution, message persistence, error handling
import type { ChatMessage } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useMessageStore } from "./messageStore";
import { useStreamStore, clearShelvedStream, clearStreamContentCache } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useVaultStore } from "./vaultStore";
import { parseErrorMessage } from "../constants";
import { toErrorMessage } from "../utils/errorUtils";
import { i18n } from "../i18n";
import {
  type StreamDoneEvent,
  msg, conv, summary,
  executeStreamCall,
  updateMessageInList,
} from "../services/streamHelpers";
import { buildConversationContext } from "../services/chatHelpers";
import { mapDbMessages } from "../services/conversationLifecycle";
import { logger } from "../services/logger";
import {
  type EffectiveSettings,
  estimateContextTokens,
  checkAndFlushPreCompaction,
} from "./chatFlowCore";

// ── Stream one turn ─────────────────────────────────

export interface StreamOneTurnParams {
  baseSystemPrompt: string;
  effective: EffectiveSettings;
  requestId: string;
  msgId: string;
  tools?: object[];
  /** 기존 tools에 추가할 도구 목록 (예: delegate) */
  extraTools?: object[];
  skillsSection?: string;
  credentialsSection?: string;
  workspacePath?: string;
  bootContent?: string | null;
  /** 명시적으로 summary를 override (예: 팀 리더는 null 사용) */
  overrideSummary?: string | null;
  /** true이면 pre-compaction 체크를 건너뜀 (팀 리더 등 경량 컨텍스트) */
  skipPreCompaction?: boolean;
}

/**
 * 단일 스트림 턴 실행: pre-compaction 체크 → 컨텍스트 빌드 → LLM 스트림 호출
 * chatFlowStore와 teamChatFlowStore에서 공유
 */
export async function streamOneTurn(params: StreamOneTurnParams): Promise<StreamDoneEvent> {
  const {
    baseSystemPrompt, effective, requestId, msgId,
    tools, extraTools, skillsSection, credentialsSection, workspacePath, bootContent,
    overrideSummary, skipPreCompaction,
  } = params;

  // Pre-compaction check: flush if approaching context limit
  if (!skipPreCompaction) {
    const totalTokenEstimate = estimateContextTokens({
      messages: msg().messages,
      baseSystemPrompt,
      skillsSection,
      bootContent,
      consolidatedMemory: conv().consolidatedMemory,
      isLearning: conv().getCurrentLearningMode(),
      vaultNotes: useVaultStore.getState().notes,
      memNotes: useMemoryStore.getState().notes,
      workspacePath,
    });
    await checkAndFlushPreCompaction(totalTokenEstimate, effective.model);
  }

  const useSummary = overrideSummary !== undefined ? overrideSummary : summary().currentSummary;

  const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
    messages: msg().messages,
    summary: useSummary,
    baseSystemPrompt,
    skillsSection,
    credentialsSection,
    bootContent,
    memoryNotes: useMemoryStore.getState().notes,
    vaultNotes: useVaultStore.getState().notes,
    workspacePath,
    learningMode: conv().getCurrentLearningMode(),
    consolidatedMemory: conv().consolidatedMemory,
  });

  // Merge tools + extraTools
  const mergedTools = mergeTools(tools, extraTools);

  return executeStreamCall({
    requestId,
    msgId,
    messages: chatMessages as Record<string, unknown>[],
    systemPrompt,
    model: effective.model,
    temperature: effective.temperature,
    thinkingEnabled: effective.thinkingEnabled,
    thinkingBudget: effective.thinkingBudget,
    tools: mergedTools,
  });
}

/** tools와 extraTools를 병합 (둘 다 없으면 null) */
function mergeTools(tools?: object[], extraTools?: object[]): object[] | null {
  if (!extraTools || extraTools.length === 0) return tools ?? null;
  return [...(tools ?? []), ...extraTools];
}

// ── 어시스턴트 메시지 저장 + 도구 호출 포함 ─────────

export interface SaveToolCallMessageOptions {
  convId: string;
  msgId: string;
  replyContent: string;
  reasoningContent?: string;
  parsedToolCalls: import("../services/types").ToolCall[];
  /** 추가 저장 필드 (team: sender_agent_id 등) */
  saveExtras?: Record<string, unknown>;
}

/** 도구 호출이 포함된 어시스턴트 메시지를 DB에 저장하고 UI 상태 업데이트 */
export async function saveAssistantToolCallMessage(options: SaveToolCallMessageOptions): Promise<void> {
  const { convId, msgId, replyContent, reasoningContent, parsedToolCalls, saveExtras = {} } = options;

  const savedAssistant = await cmds.saveMessage({
    conversation_id: convId,
    role: "assistant",
    content: replyContent,
    tool_name: "tool_calls",
    tool_input: JSON.stringify(parsedToolCalls),
    ...saveExtras,
  });

  useMessageStore.setState({
    messages: updateMessageInList(msg().messages, msgId, {
      dbMessageId: savedAssistant.id,
      content: replyContent,
      reasoningContent,
      tool_calls: parsedToolCalls,
      status: "complete",
    }),
  });
}

// ── 최종 응답 저장 (도구 없음) ──────────────────────

export interface SaveFinalResponseOptions {
  convId: string;
  msgId: string;
  replyContent: string;
  reasoningContent?: string;
  /** 추가 저장 필드 (team: sender_agent_id, team_run_id 등) */
  saveExtras?: Record<string, unknown>;
  /** UI 메시지에 추가할 필드 (team: senderAgentId, senderAgentName 등) */
  uiExtras?: Partial<ChatMessage>;
}

/** 도구 호출 없는 최종 응답을 DB에 저장하고 UI 상태 업데이트 */
export async function saveFinalResponse(options: SaveFinalResponseOptions): Promise<string> {
  const { convId, msgId, replyContent, reasoningContent, saveExtras = {}, uiExtras } = options;
  const finalContent = replyContent || i18n.t("common:noResponse");

  const savedAssistant = await cmds.saveMessage({
    conversation_id: convId,
    role: "assistant",
    content: finalContent,
    ...saveExtras,
  });

  const updated = updateMessageInList(msg().messages, msgId, {
    dbMessageId: savedAssistant.id,
    content: finalContent,
    reasoningContent,
    status: "complete",
    ...uiExtras,
  });
  useMessageStore.setState({ messages: updated });

  // If the pending message was not found (user navigated away and messages
  // were reloaded from DB while streaming), reload messages from DB so
  // the just-saved response becomes visible.
  const wasApplied = updated.some((m) => m.dbMessageId === savedAssistant.id);
  if (!wasApplied && conv().currentConversationId === convId) {
    try {
      const findAgent = (id: string) => useAgentStore.getState().agents.find((a) => a.id === id);
      const dbMessages = await cmds.getMessages(convId);
      const recovered = mapDbMessages(dbMessages, findAgent);
      // Patch the just-saved message with reasoningContent which is not
      // persisted in DB but still available in memory from the stream.
      if (reasoningContent) {
        const idx = recovered.findIndex((m) => m.dbMessageId === savedAssistant.id);
        if (idx >= 0) {
          recovered[idx] = { ...recovered[idx], reasoningContent };
        }
      }
      useMessageStore.setState({ messages: recovered });
    } catch (e) {
      logger.debug("Failed to reload messages after deferred save", e);
    }
  }

  clearShelvedStream(convId);
  clearStreamContentCache(msgId);
  return savedAssistant.id;
}

// ── 스트림 에러 처리 ────────────────────────────────

/** 스트림 에러 시 메시지 상태 업데이트 및 스트림 정리 */
export function handleStreamError(error: unknown, msgId: string): void {
  logger.error("Stream Error:", error);
  useMessageStore.setState({
    messages: updateMessageInList(msg().messages, msgId, {
      content: parseErrorMessage(error),
      status: "failed",
      error: toErrorMessage(error),
    }),
  });
  useStreamStore.setState({ activeRun: null });
  useToolRunStore.getState().resetToolState();
}

// ── 중단 처리 ───────────────────────────────────────

/** 스트림 중단 시 메시지 상태 업데이트 */
export function handleStreamAbort(msgId: string): void {
  useMessageStore.setState({
    messages: updateMessageInList(msg().messages, msgId, { status: "aborted" }),
  });
  useStreamStore.setState({ activeRun: null });
  useToolRunStore.getState().resetToolState();
}

// ── 최대 반복 초과 처리 ─────────────────────────────

/** 도구 반복 횟수 초과 시 메시지 상태 업데이트 */
export function handleMaxIterations(msgId: string, replyContent: string): void {
  useMessageStore.setState({
    messages: updateMessageInList(msg().messages, msgId, {
      content: replyContent || i18n.t("agent:tools.maxIterations"),
      status: "failed",
    }),
  });
  useStreamStore.setState({ activeRun: null });
  useToolRunStore.getState().resetToolState();
}
