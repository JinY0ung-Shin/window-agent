// 공유 로직: chatFlowStore와 teamChatFlowStore에서 중복되는 패턴을 추출한 모듈
import type { Agent, ChatMessage, Conversation, MemoryNote, ToolCall } from "../services/types";
import type { VaultNoteSummary } from "../services/vaultTypes";
import type { LifecycleEvent } from "../services/lifecycleEvents";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useMessageStore } from "./messageStore";
import { useStreamStore } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useVaultStore } from "./vaultStore";
import { useConversationStore } from "./conversationStore";
import {
  readPersonaFiles,
  assembleSystemPrompt,
  assembleManagerPrompt,
  getEffectiveSettings,
  invalidatePersonaCache,
} from "../services/personaService";
import { getEffectiveTools, toOpenAITools, type ToolDefinition } from "../services/toolRegistry";
import { readToolConfig } from "../services/nativeToolRegistry";
import { CONVERSATION_TITLE_MAX_LENGTH, DEFAULT_SYSTEM_PROMPT, parseErrorMessage } from "../constants";
import { toErrorMessage } from "../utils/errorUtils";
import { i18n } from "../i18n";
import {
  type StreamDoneEvent,
  MAX_TOOL_ITERATIONS,
  msg,
  conv,
  summary,
  createPendingMessage,
  updateMessageInList,
  classifyToolCalls,
  executeToolPipeline,
  executeStreamCall,
} from "../services/streamHelpers";
import { buildConversationContext } from "../services/chatHelpers";
import {
  extractBrowserDomain,
  approveBrowserDomain,
} from "../services/browserApprovalService";
import { estimateTokens } from "../services/tokenEstimator";
import { shouldFlush, preCompactFlush } from "../services/preCompactService";
import { logger } from "../services/logger";

// ── 에이전트 해석 ────────────────────────────────────

export interface ResolvedAgent {
  agentId: string | null;
  agent: Agent | null;
}

/** 대화 또는 전역 선택에서 에이전트 해석 */
export function resolveAgentForConversation(
  currentConversationId: string | null,
  conversations: Conversation[],
): ResolvedAgent {
  const agentStore = useAgentStore.getState();
  let agentId: string | null = null;

  if (currentConversationId) {
    const convObj = conversations.find((c: Conversation) => c.id === currentConversationId);
    agentId = convObj?.agent_id ?? null;
  } else {
    agentId = agentStore.selectedAgentId;
  }

  const agent = agentId
    ? agentStore.agents.find((a: Agent) => a.id === agentId) ?? null
    : null;

  return { agentId, agent };
}

// ── 토큰 추정 ────────────────────────────────────────

export interface TokenEstimationParams {
  messages: ChatMessage[];
  baseSystemPrompt: string;
  skillsSection?: string;
  bootContent?: string | null;
  consolidatedMemory: string | null;
  isLearning: boolean;
  vaultNotes: VaultNoteSummary[];
  memNotes: MemoryNote[];
  workspacePath?: string;
}

/**
 * 시스템 프롬프트 + 메시지 + 메모리 노트로 전체 토큰 사용량 추정
 * Pre-compaction 판단에 사용
 */
export function estimateContextTokens(params: TokenEstimationParams): number {
  const {
    messages, baseSystemPrompt, skillsSection, bootContent,
    consolidatedMemory, isLearning, vaultNotes, memNotes, workspacePath,
  } = params;

  const notesTokens = vaultNotes.length > 0
    ? Math.min(
        vaultNotes.reduce((s, n) => s + estimateTokens(n.title + (n.bodyPreview ?? "")) + 4, 0),
        isLearning ? 1500 : 500,
      )
    : Math.min(
        memNotes.reduce((s, n) => s + estimateTokens(n.title + n.content) + 4, 0),
        isLearning ? 1500 : 500,
      );

  const systemOverhead =
    estimateTokens(baseSystemPrompt) +
    (skillsSection ? estimateTokens(skillsSection) : 0) +
    (bootContent ? estimateTokens(bootContent) : 0) +
    (consolidatedMemory ? estimateTokens(consolidatedMemory) : 0) +
    (consolidatedMemory && isLearning ? Math.min(notesTokens, 700) :
     !consolidatedMemory ? notesTokens : 0) +
    (workspacePath ? 200 : 0) +
    (isLearning ? 300 : 0) +
    500;

  return systemOverhead + messages.reduce(
    (sum: number, m: ChatMessage) => sum + estimateTokens(m.content) + 4,
    0,
  );
}

// ── Pre-compaction 체크 ──────────────────────────────

/**
 * 토큰 추정치가 모델 한계에 가까우면 pre-compaction flush 실행
 * streamOneTurn 호출 전에 사용
 */
export async function checkAndFlushPreCompaction(
  totalTokenEstimate: number,
  model: string,
): Promise<void> {
  const currentConvId = conv().currentConversationId;
  if (!shouldFlush(totalTokenEstimate, model) || !currentConvId) return;

  const convObj = conv().conversations.find((c: Conversation) => c.id === currentConvId);
  const flushAgentId = convObj?.agent_id;
  if (flushAgentId) {
    await preCompactFlush(currentConvId, flushAgentId, model, totalTokenEstimate);
  }
}

// ── 새 대화 생성 ─────────────────────────────────────

export interface EnsureConversationParams {
  currentConversationId: string | null;
  agentId: string | null;
  agent: Agent | null;
  inputValue: string;
  emitLifecycleEvent: (event: LifecycleEvent) => void;
}

export interface EnsureConversationResult {
  convId: string;
  isNew: boolean;
}

/**
 * 기존 대화를 반환하거나, 없으면 새 대화를 생성.
 * 새 대화 시 lifecycle 이벤트 발행, draft learning mode 전파, 스킬 저장
 */
export async function ensureConversation(
  params: EnsureConversationParams,
  hooks: {
    loadSkills: (folderName: string) => Promise<void>;
    getActiveSkillNames: () => string[];
    getDraftLearningMode: () => boolean;
  },
): Promise<EnsureConversationResult | null> {
  const { currentConversationId, agentId, agent, inputValue, emitLifecycleEvent } = params;

  if (currentConversationId) {
    return { convId: currentConversationId, isNew: false };
  }

  if (!agentId) {
    logger.error("No agent selected for new conversation");
    return null;
  }

  const initialTitle =
    inputValue.slice(0, CONVERSATION_TITLE_MAX_LENGTH) ||
    i18n.t("common:defaultConversationTitle");
  const newConv = await cmds.createConversation(agentId, initialTitle);
  const convId = newConv.id;
  useConversationStore.setState({ currentConversationId: convId });

  emitLifecycleEvent({ type: "session:start", conversationId: convId, agentId });
  if (agent) {
    emitLifecycleEvent({ type: "agent:boot", agentId, folderName: agent.folder_name });
  }

  const draftLearningMode = hooks.getDraftLearningMode();
  if (draftLearningMode) {
    await cmds.setLearningMode(convId, true);
    useConversationStore.setState({ currentLearningMode: true, draftLearningMode: false });
  }

  const skillNames = hooks.getActiveSkillNames();
  if (skillNames.length > 0) {
    await cmds.updateConversationSkills(convId, skillNames);
  }

  return { convId, isNew: true };
}

// ── Stream one turn ─────────────────────────────────

export interface StreamOneTurnParams {
  baseSystemPrompt: string;
  effective: EffectiveSettings;
  requestId: string;
  msgId: string;
  tools?: object[];
  skillsSection?: string;
  workspacePath?: string;
  bootContent?: string | null;
}

/**
 * 단일 스트림 턴 실행: pre-compaction 체크 → 컨텍스트 빌드 → LLM 스트림 호출
 * chatFlowStore와 teamChatFlowStore에서 공유
 */
export async function streamOneTurn(params: StreamOneTurnParams): Promise<StreamDoneEvent> {
  const { baseSystemPrompt, effective, requestId, msgId, tools, skillsSection, workspacePath, bootContent } = params;

  // Pre-compaction check: flush if approaching context limit
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

  const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
    messages: msg().messages,
    summary: summary().currentSummary,
    baseSystemPrompt,
    skillsSection,
    bootContent,
    memoryNotes: useMemoryStore.getState().notes,
    vaultNotes: useVaultStore.getState().notes,
    workspacePath,
    learningMode: conv().getCurrentLearningMode(),
    consolidatedMemory: conv().consolidatedMemory,
  });

  return executeStreamCall({
    requestId,
    msgId,
    messages: chatMessages as Record<string, unknown>[],
    systemPrompt,
    model: effective.model,
    temperature: effective.temperature,
    thinkingEnabled: effective.thinkingEnabled,
    thinkingBudget: effective.thinkingBudget,
    tools: tools ?? null,
  });
}

// ── 도구 반복 루프 ──────────────────────────────────

export interface ToolLoopParams {
  convId: string;
  baseSystemPrompt: string;
  effective: EffectiveSettings;
  toolDefinitions: ToolDefinition[];
  autoApproveEnabled: boolean;
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
    autoApproveEnabled, openAITools, skillsSection, workspacePath, bootContent,
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
      workspacePath,
      iterationCount,
    });

    currentRequestId = `req-${Date.now()}`;
    const { msgId: nextMsgId, msg: nextPending } = createPendingMessage(currentRequestId);
    currentMsgId = nextMsgId;

    useMessageStore.setState({
      messages: [...msg().messages, ...savedToolMsgs, nextPending],
    });
    useToolRunStore.setState({ toolRunState: "continuing" });
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
