// Tool loop, tool call processing, store refresh
import type { Agent, ChatMessage, ToolCall } from "../services/types";
import { useAgentStore } from "./agentStore";
import { useMessageStore } from "./messageStore";
import { useStreamStore, clearShelvedStream, clearStreamContentCache } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useVaultStore } from "./vaultStore";
import { invalidatePersonaCache } from "../services/personaService";
import { type ToolDefinition } from "../services/toolRegistry";
import {
  MAX_TOOL_ITERATIONS,
  msg, conv, summary,
  createPendingMessage,
  classifyToolCalls,
  executeToolPipeline,
} from "../services/streamHelpers";
import {
  extractBrowserDomain,
  approveBrowserDomain,
} from "../services/browserApprovalService";
import type { EffectiveSettings } from "./chatFlowCore";
import {
  streamOneTurn,
  saveFinalResponse,
  saveAssistantToolCallMessage,
  handleStreamAbort,
  handleMaxIterations,
} from "./streamResponses";

// ── 도구 반복 루프 ──────────────────────────────────

export interface ToolLoopParams {
  convId: string;
  baseSystemPrompt: string;
  effective: EffectiveSettings;
  toolDefinitions: ToolDefinition[];
  autoApproveEnabled: boolean;
  agentHasCredentials?: boolean;
  credentialsSection?: string;
  openAITools?: object[];
  skillsSection?: string;
  workspacePath?: string;
  bootContent?: string | null;
  /** 추가 저장 필드 (team: sender_agent_id 등) */
  saveExtras?: Record<string, unknown>;
}

export interface ToolLoopState {
  currentRequestId: string;
  currentMsgId: string;
}

/**
 * streamOneTurn을 반복 호출하며 도구 호출을 처리하는 루프
 * 도구 없는 최종 응답이 오거나 최대 반복 초과 시 종료
 */
export async function runToolLoop(
  params: ToolLoopParams,
  state: ToolLoopState,
): Promise<void> {
  const {
    convId, baseSystemPrompt, effective, toolDefinitions,
    autoApproveEnabled, agentHasCredentials, credentialsSection,
    openAITools, skillsSection, workspacePath, bootContent,
    saveExtras,
  } = params;
  let { currentRequestId, currentMsgId } = state;

  let iterationCount = 0;

  while (iterationCount <= MAX_TOOL_ITERATIONS) {
    const done = await streamOneTurn({
      baseSystemPrompt,
      effective,
      requestId: currentRequestId,
      msgId: currentMsgId,
      tools: openAITools,
      skillsSection,
      credentialsSection,
      workspacePath,
      bootContent,
    });

    if (done.error) {
      if (done.error === "aborted") {
        handleStreamAbort(currentMsgId);
        return;
      }
      throw new Error(done.error);
    }

    const replyContent = done.full_content || "";
    const reasoningContent = done.reasoning_content ?? undefined;
    const toolCalls = done.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      await saveFinalResponse({
        convId,
        msgId: currentMsgId,
        replyContent,
        reasoningContent,
        saveExtras,
      });

      useStreamStore.setState({ activeRun: null });
      useToolRunStore.getState().resetToolState();

      summary().maybeGenerateSummary(
        convId, baseSystemPrompt, msg().messages, () => conv().loadConversations(),
      );
      return;
    }

    iterationCount++;
    if (iterationCount > MAX_TOOL_ITERATIONS) {
      handleMaxIterations(currentMsgId, replyContent);
      return;
    }

    const parsedToolCalls = parseRawToolCalls(toolCalls);

    await saveAssistantToolCallMessage({
      convId,
      msgId: currentMsgId,
      replyContent,
      reasoningContent,
      parsedToolCalls,
      saveExtras,
    });

    const savedToolMsgs = await processToolCalls(parsedToolCalls, {
      convId,
      toolDefinitions,
      autoApproveEnabled,
      agentHasCredentials,
      workspacePath,
      iterationCount,
    });

    // Check if generation was cancelled during tool execution (user navigated away)
    if (!useStreamStore.getState().activeRun) {
      // Clear shelved stream — this run completed, so restoring it would
      // leave the UI stuck with a stale "streaming" message.
      clearShelvedStream(convId);
      clearStreamContentCache(currentMsgId);
      if (savedToolMsgs.length > 0) {
        useMessageStore.setState({
          messages: [...msg().messages, ...savedToolMsgs],
        });
      }
      return;
    }

    currentRequestId = `req-${Date.now()}`;
    const { msgId: nextMsgId, msg: nextPending } = createPendingMessage(currentRequestId);
    currentMsgId = nextMsgId;

    useMessageStore.setState({
      messages: [...msg().messages, ...savedToolMsgs, nextPending],
    });
    useToolRunStore.getState().setContinuing();
    useStreamStore.setState({
      activeRun: {
        requestId: currentRequestId,
        conversationId: convId,
        targetMessageId: currentMsgId,
        status: "pending",
      },
    });
  }
}

// ── 도구 실행 후 스토어 갱신 ────────────────────────

/** 도구 호출 결과에 따라 vault/persona 캐시 갱신 */
export async function refreshStoresAfterToolCalls(parsedToolCalls: ToolCall[]): Promise<void> {
  const agentId = useAgentStore.getState().selectedAgentId;
  if (!agentId) return;

  const hasVaultChange = parsedToolCalls.some((tc) => {
    if (tc.name !== "write_file" && tc.name !== "delete_file") return false;
    try { return JSON.parse(tc.arguments).scope === "vault"; } catch { return false; }
  });
  const hasPersonaChange = parsedToolCalls.some((tc) => {
    if (tc.name !== "write_file" && tc.name !== "delete_file") return false;
    try { return JSON.parse(tc.arguments).scope === "persona"; } catch { return false; }
  });

  if (hasVaultChange) {
    await useVaultStore.getState().loadNotes(agentId);
  }
  if (hasPersonaChange) {
    const agent = useAgentStore.getState().agents.find((a: Agent) => a.id === agentId);
    if (agent) invalidatePersonaCache(agent.folder_name);
  }
}

// ── 도구 호출 처리 (분류 → 실행 → 갱신) ────────────

export interface ProcessToolCallsOptions {
  convId: string;
  toolDefinitions: ToolDefinition[];
  autoApproveEnabled: boolean;
  agentHasCredentials?: boolean;
  workspacePath?: string;
  iterationCount?: number;
  /** 팀 실행 시 run별 상태 분리를 위한 runId */
  runId?: string;
  /** 도구 확인 승인 시 추가 콜백 */
  onConfirmApproved?: (tools: ToolCall[]) => void;
}

/**
 * 도구 호출을 분류하고 실행한 뒤 스토어를 갱신하는 공통 파이프라인
 * chatFlowStore와 teamChatFlowStore 모두에서 동일한 패턴을 사용
 */
export async function processToolCalls(
  parsedToolCalls: ToolCall[],
  options: ProcessToolCallsOptions,
): Promise<ChatMessage[]> {
  const { convId, toolDefinitions, autoApproveEnabled, agentHasCredentials, workspacePath, iterationCount, runId, onConfirmApproved } = options;

  const classification = classifyToolCalls(parsedToolCalls, toolDefinitions, {
    workspacePath,
    convId,
    autoApproveEnabled,
    agentHasCredentials,
  });

  const savedToolMsgs = await executeToolPipeline(classification, convId, {
    iterationCount,
    runId,
    onConfirmApproved: (tools) => {
      // 브라우저 도메인 승인 기록 (workspace가 있는 경우)
      for (const tc of tools) {
        const domain = extractBrowserDomain(tc.name, tc.arguments);
        if (domain) approveBrowserDomain(convId, domain);
      }
      onConfirmApproved?.(tools);
    },
  });

  await refreshStoresAfterToolCalls(parsedToolCalls);

  return savedToolMsgs;
}

// ── 도구 호출 파싱 ──────────────────────────────────

/** 스트림 도구 호출 응답을 ToolCall 배열로 변환 */
export function parseRawToolCalls(
  toolCalls: { id: string; type: string; function: { name: string; arguments: string } }[],
): ToolCall[] {
  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}
