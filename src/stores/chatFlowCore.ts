// Agent/settings resolution, context estimation, conversation creation
import type { Agent, ChatMessage, Conversation, MemoryNote } from "../services/types";
import type { VaultNoteSummary } from "../services/vaultTypes";
import type { LifecycleEvent } from "../services/lifecycleEvents";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import { useConversationStore } from "./conversationStore";
import {
  readPersonaFiles,
  assembleSystemPrompt,
  assembleManagerPrompt,
  getEffectiveSettings,
} from "../services/personaService";
import { getEffectiveTools, toOpenAITools, type ToolDefinition } from "../services/toolRegistry";
import { readToolConfig } from "../services/nativeToolRegistry";
import { listCredentials } from "../services/commands/credentialCommands";
import { CONVERSATION_TITLE_MAX_LENGTH, DEFAULT_SYSTEM_PROMPT } from "../constants";
import { i18n } from "../i18n";
import { conv } from "../services/streamHelpers";
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

  // Vault guide is injected when any of these are present (~200 tokens)
  const hasVaultGuide = vaultNotes.length > 0 || isLearning || !!consolidatedMemory;

  const systemOverhead =
    estimateTokens(baseSystemPrompt) +
    (skillsSection ? estimateTokens(skillsSection) : 0) +
    (bootContent ? estimateTokens(bootContent) : 0) +
    (hasVaultGuide ? 200 : 0) +
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
  // Add the new conversation to the list immediately so that navigation
  // (openAgentChat) can find it before loadConversations() runs after the
  // stream completes.
  useConversationStore.setState((state) => ({
    currentConversationId: convId,
    conversations: [newConv, ...state.conversations],
  }));

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
  agentHasCredentials: boolean;
  credentialsSection?: string;
  openAITools: object[] | undefined;
}

/** Convert a credential ID to an environment variable name (mirrors Rust credential_id_to_env_var). */
export function credentialIdToEnvVar(id: string): string {
  return "CRED_" + id.toUpperCase().replace(/[-\s]/g, "_").replace(/[^A-Z0-9_]/g, "");
}

/** 에이전트의 도구 정의 및 자동 승인 설정 로드 */
export async function resolveToolConfig(agent: Agent | null): Promise<AgentToolConfig> {
  let toolDefinitions: ToolDefinition[] = [];
  let autoApproveEnabled = false;
  let agentHasCredentials = false;
  let credentialsSection: string | undefined;

  if (agent) {
    try {
      toolDefinitions = await getEffectiveTools(agent.folder_name);
    } catch (e) { logger.debug("No tools for agent", e); }
    try {
      const tc = await readToolConfig(agent.folder_name);
      autoApproveEnabled = tc?.auto_approve ?? false;
      // Check if agent has any allowed credentials and build credentials section
      if (tc?.credentials) {
        const allowedIds: string[] = [];
        for (const [id, v] of Object.entries(tc.credentials)) {
          const isAllowed = typeof v === "boolean" ? v
            : (typeof v === "object" && v !== null && "allowed" in v) ? (v as { allowed: boolean }).allowed
            : false;
          if (isAllowed) allowedIds.push(id);
        }
        agentHasCredentials = allowedIds.length > 0;

        // Build credentials section if run_shell or browser_type is enabled and there are credentials
        const hasRunCommand = toolDefinitions.some(t => t.name === "run_shell");
        const hasBrowserType = toolDefinitions.some(t => t.name === "browser_type");
        if (agentHasCredentials && (hasRunCommand || hasBrowserType)) {
          try {
            const allMetas = await listCredentials();
            const isWindows = navigator.platform?.startsWith("Win") ?? false;
            const isValidBrowserId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);
            const lines = allowedIds
              .map(id => {
                const meta = allMetas.find(m => m.id === id);
                const displayName = meta?.name ?? id;
                const parts: string[] = [];
                if (hasRunCommand) {
                  const envName = credentialIdToEnvVar(id);
                  parts.push(isWindows ? `%${envName}%` : `$${envName}`);
                }
                if (hasBrowserType && isValidBrowserId(id)) {
                  parts.push(`{{credential:${id}}}`);
                }
                const desc = meta?.description ? ` — ${meta.description}` : "";
                return `- ${id} (${displayName}): ${parts.join(", ")}${desc}`;
              })
              .sort();
            const instructions: string[] = [];
            if (hasRunCommand) instructions.push("Use env vars in shell commands via run_shell.");
            if (hasBrowserType) instructions.push("Use {{credential:ID}} in browser_type text parameter for password/login fields.");
            instructions.push("Never echo, print, or expose credential values directly.");
            credentialsSection = [
              "[AVAILABLE CREDENTIALS]",
              "The following credentials are available:",
              ...lines,
              instructions.join(" "),
            ].join("\n");
          } catch (e) { logger.debug("Failed to load credential metadata", e); }
        }
      }
    } catch (e) { logger.debug("No tool config, using defaults", e); }
  }

  const openAITools = toolDefinitions.length > 0 ? toOpenAITools(toolDefinitions) : undefined;
  return { toolDefinitions, autoApproveEnabled, agentHasCredentials, credentialsSection, openAITools };
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
