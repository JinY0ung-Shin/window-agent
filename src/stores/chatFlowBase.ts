// 공유 로직: chatFlowStore와 teamChatFlowStore에서 중복되는 패턴을 추출한 모듈
import type { Agent, ChatMessage, ToolCall } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import { useMessageStore } from "./messageStore";
import { useStreamStore } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useVaultStore } from "./vaultStore";
import {
  readPersonaFiles,
  assembleSystemPrompt,
  assembleManagerPrompt,
  getEffectiveSettings,
  invalidatePersonaCache,
} from "../services/personaService";
import { getEffectiveTools, toOpenAITools, type ToolDefinition } from "../services/toolRegistry";
import { readToolConfig } from "../services/nativeToolRegistry";
import { DEFAULT_SYSTEM_PROMPT, parseErrorMessage } from "../constants";
import { toErrorMessage } from "../utils/errorUtils";
import { i18n } from "../i18n";
import {
  msg,
  updateMessageInList,
  classifyToolCalls,
  executeToolPipeline,
} from "../services/streamHelpers";
import {
  extractBrowserDomain,
  approveBrowserDomain,
} from "../services/browserApprovalService";
import { logger } from "../services/logger";

// ── 에이전트 설정 해석 ──────────────────────────────

export interface EffectiveSettings {
  model: string;
  temperature: number | null;
  thinkingEnabled: boolean;
  thinkingBudget: number | null;
}

/** 에이전트 또는 전역 설정에서 유효한 모델 설정 결정 */
export function resolveEffectiveSettings(agent: Agent | null): EffectiveSettings {
  if (agent) return getEffectiveSettings(agent);
  const settings = useSettingsStore.getState();
  return {
    model: settings.modelName,
    temperature: null,
    thinkingEnabled: settings.thinkingEnabled,
    thinkingBudget: settings.thinkingBudget,
  };
}

// ── 도구 정의 로드 ──────────────────────────────────

export interface AgentToolConfig {
  toolDefinitions: ToolDefinition[];
  autoApproveEnabled: boolean;
  openAITools: object[] | undefined;
}

/** 에이전트의 도구 정의 및 자동 승인 설정 로드 */
export async function resolveToolConfig(agent: Agent | null): Promise<AgentToolConfig> {
  let toolDefinitions: ToolDefinition[] = [];
  let autoApproveEnabled = false;

  if (agent) {
    try {
      toolDefinitions = await getEffectiveTools(agent.folder_name);
    } catch (e) { logger.debug("No tools for agent", e); }
    try {
      const tc = await readToolConfig(agent.folder_name);
      autoApproveEnabled = tc?.auto_approve ?? false;
    } catch (e) { logger.debug("No tool config, using defaults", e); }
  }

  const openAITools = toolDefinitions.length > 0 ? toOpenAITools(toolDefinitions) : undefined;
  return { toolDefinitions, autoApproveEnabled, openAITools };
}

// ── 시스템 프롬프트 조립 ────────────────────────────

/** 에이전트의 페르소나 파일로 시스템 프롬프트 조립 (단일 에이전트: 일반/매니저 자동 판별) */
export async function resolveSystemPrompt(
  agent: Agent | null,
  enabledToolNames: string[],
  companyName: string,
): Promise<string> {
  if (!agent) return DEFAULT_SYSTEM_PROMPT;

  try {
    const files = await readPersonaFiles(agent.folder_name);
    if (agent.is_default) {
      return assembleManagerPrompt(
        files,
        useAgentStore.getState().agents,
        companyName,
        enabledToolNames,
      );
    }
    return assembleSystemPrompt(files);
  } catch (e) {
    logger.debug("Persona read failed, using default prompt", e);
    return DEFAULT_SYSTEM_PROMPT;
  }
}

/** 매니저 프롬프트만 조립 (팀 리더용) */
export async function resolveManagerPrompt(
  agent: Agent | null,
  enabledToolNames: string[],
  companyName: string,
): Promise<string> {
  if (!agent) return DEFAULT_SYSTEM_PROMPT;

  try {
    const files = await readPersonaFiles(agent.folder_name);
    return assembleManagerPrompt(
      files,
      useAgentStore.getState().agents,
      companyName,
      enabledToolNames,
    );
  } catch (e) {
    logger.debug("Leader persona read failed, using default prompt", e);
    return DEFAULT_SYSTEM_PROMPT;
  }
}

// ── 워크스페이스 경로 해석 ──────────────────────────

/** convId에 연결된 워크스페이스 경로 조회 (실패 시 undefined) */
export async function resolveWorkspacePath(convId: string): Promise<string | undefined> {
  try {
    return await cmds.getWorkspacePath(convId);
  } catch (e) {
    logger.debug("Workspace path unavailable", e);
    return undefined;
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
  workspacePath?: string;
  iterationCount?: number;
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
  const { convId, toolDefinitions, autoApproveEnabled, workspacePath, iterationCount, onConfirmApproved } = options;

  const classification = classifyToolCalls(parsedToolCalls, toolDefinitions, {
    workspacePath,
    convId,
    autoApproveEnabled,
  });

  const savedToolMsgs = await executeToolPipeline(classification, convId, {
    iterationCount,
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

// ── 어시스턴트 메시지 저장 + 도구 호출 포함 ─────────

export interface SaveToolCallMessageOptions {
  convId: string;
  msgId: string;
  replyContent: string;
  reasoningContent?: string;
  parsedToolCalls: ToolCall[];
  /** 추가 저장 필드 (team: sender_agent_id, team_run_id 등) */
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
}

/** 도구 호출 없는 최종 응답을 DB에 저장하고 UI 상태 업데이트 */
export async function saveFinalResponse(options: SaveFinalResponseOptions): Promise<string> {
  const { convId, msgId, replyContent, reasoningContent, saveExtras = {} } = options;
  const finalContent = replyContent || i18n.t("common:noResponse");

  const savedAssistant = await cmds.saveMessage({
    conversation_id: convId,
    role: "assistant",
    content: finalContent,
    ...saveExtras,
  });

  useMessageStore.setState({
    messages: updateMessageInList(msg().messages, msgId, {
      dbMessageId: savedAssistant.id,
      content: finalContent,
      reasoningContent,
      status: "complete",
    }),
  });

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
