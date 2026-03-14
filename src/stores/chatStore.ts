import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { Conversation, ChatMessage, ActiveRun, ToolCall, ToolRunState } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useDebugStore } from "./debugStore";
import { useSkillStore } from "./skillStore";
import { buildChatMessages, buildConversationContext } from "../services/chatHelpers";
import { estimateTokens, estimateMessageTokens } from "../services/tokenEstimator";
import {
  readPersonaFiles,
  assembleSystemPrompt,
  assembleManagerPrompt,
  getEffectiveSettings,
  invalidatePersonaCache,
} from "../services/personaService";
import {
  executeBootstrapTurn,
  parseAgentName,
  isBootstrapComplete,
} from "../services/bootstrapService";
import { getToolsForAgent, toOpenAITools, getToolTier, type ToolDefinition } from "../services/toolRegistry";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  DEFAULT_CONVERSATION_TITLE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_AGENT_NAME,
  LOADING_MESSAGE,
  NO_RESPONSE_MESSAGE,
  MAX_CONTEXT_TOKENS,
  TITLE_GENERATION_PROMPT,
  SUMMARY_GENERATION_PROMPT,
  parseErrorMessage,
  DEFAULT_TOOLS_MD,
} from "../constants";

// ── Stream event types ────────────────────────────────
type StreamChunkEvent = { request_id: string; delta: string; reasoning_delta: string | null };
type StreamDoneEvent = {
  request_id: string;
  full_content: string;
  reasoning_content: string | null;
  tool_calls: { id: string; type: string; function: { name: string; arguments: string } }[] | null;
  error: string | null;
};

// ── Helpers ────────────────────────────────────────────

const BOOTSTRAP_RESET = {
  isBootstrapping: false,
  bootstrapFolderName: null as string | null,
  bootstrapApiHistory: [] as any[],
  bootstrapFilesWritten: [] as string[],
};

function createPendingMessage(requestId?: string): { msgId: string; msg: ChatMessage } {
  const msgId = `pending-${Date.now()}`;
  return {
    msgId,
    msg: {
      id: msgId,
      type: "agent",
      content: LOADING_MESSAGE,
      status: "pending",
      requestId,
    },
  };
}

function updateMessage(
  messages: ChatMessage[],
  targetId: string,
  updates: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((msg) =>
    msg.id === targetId ? { ...msg, ...updates } : msg,
  );
}

// ── Store ──────────────────────────────────────────────

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: ChatMessage[];
  inputValue: string;
  activeRun: ActiveRun | null;

  // Summary
  currentSummary: string | null;
  summaryUpToMessageId: string | null;
  summaryJobId: string | null;

  // Tool run state
  toolRunState: ToolRunState;
  pendingToolCalls: ToolCall[];
  toolIterationCount: number;

  // Bootstrap mode
  isBootstrapping: boolean;
  bootstrapFolderName: string | null;
  bootstrapApiHistory: any[];
  bootstrapFilesWritten: string[];

  setInputValue: (v: string) => void;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createNewConversation: () => void;
  prepareForAgent: (agentId: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: () => Promise<void>;
  startBootstrap: () => Promise<void>;
  cancelBootstrap: () => void;
  copyMessage: (messageId: string) => void;
  regenerateMessage: (messageId: string) => Promise<void>;
  abortStream: () => Promise<void>;
  approveToolCall: () => Promise<void>;
  rejectToolCall: () => void;
}

const TOOL_RESET = {
  toolRunState: "idle" as ToolRunState,
  pendingToolCalls: [] as ToolCall[],
  toolIterationCount: 0,
};

const MAX_TOOL_ITERATIONS = 10;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  inputValue: "",
  activeRun: null,
  currentSummary: null,
  summaryUpToMessageId: null,
  summaryJobId: null,
  ...TOOL_RESET,
  ...BOOTSTRAP_RESET,

  setInputValue: (v) => set({ inputValue: v }),

  copyMessage: (messageId) => {
    const msg = get().messages.find((m) => m.id === messageId);
    if (msg) navigator.clipboard.writeText(msg.content);
  },

  regenerateMessage: async (messageId: string) => {
    const { messages, activeRun, currentConversationId } = get();
    if (!currentConversationId || activeRun) return;

    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const targetMsg = messages[idx];
    const truncated = messages.slice(0, idx);

    // Delete from DB first — if this fails, UI stays intact (fix: UI/DB consistency)
    if (targetMsg.dbMessageId) {
      const result = await cmds.deleteMessagesAndMaybeResetSummary(currentConversationId, targetMsg.dbMessageId);
      if (result.summary_was_reset) {
        set({ currentSummary: null, summaryUpToMessageId: null });
      }
    }

    // DB succeeded — now update UI
    set({ messages: truncated });

    // Find last user message to re-send
    const lastUserMsg = [...truncated].reverse().find((m) => m.type === "user");
    if (!lastUserMsg) return;

    await regenerateStream(set, get, currentConversationId, truncated, lastUserMsg.content);
  },

  abortStream: async () => {
    const { activeRun } = get();
    if (!activeRun) return;
    await cmds.abortStream(activeRun.requestId);
  },

  approveToolCall: async () => {
    set({ toolRunState: "tool_running" });
    if (_toolApprovalResolve) {
      _toolApprovalResolve(true);
      _toolApprovalResolve = null;
    }
  },

  rejectToolCall: () => {
    if (_toolApprovalResolve) {
      _toolApprovalResolve(false);
      _toolApprovalResolve = null;
    }
  },

  loadConversations: async () => {
    const conversations = await cmds.getConversations();
    set({ conversations });
  },

  selectConversation: async (id) => {
    set({ currentConversationId: id, messages: [], activeRun: null, currentSummary: null, summaryUpToMessageId: null, summaryJobId: null, ...TOOL_RESET, ...BOOTSTRAP_RESET });
    const [detail, dbMessages] = await Promise.all([
      cmds.getConversationDetail(id),
      cmds.getMessages(id),
    ]);
    if (get().currentConversationId !== id) return; // stale guard
    const messages: ChatMessage[] = dbMessages.map((m) => {
      if (m.role === "user") {
        return { id: m.id, dbMessageId: m.id, type: "user" as const, content: m.content, status: "complete" as const };
      }
      // Tool result messages (role=assistant but have tool_call_id)
      if (m.tool_call_id) {
        return {
          id: m.id, dbMessageId: m.id, type: "tool" as const, content: m.content, status: "complete" as const,
          tool_call_id: m.tool_call_id, tool_name: m.tool_name ?? undefined,
        };
      }
      // Assistant messages (may have tool_calls stored as tool_name/tool_input)
      const chatMsg: ChatMessage = { id: m.id, dbMessageId: m.id, type: "agent" as const, content: m.content, status: "complete" as const };
      if (m.tool_name && m.tool_input) {
        // Reconstruct tool_calls from DB storage (tool_name is JSON array of names, tool_input is JSON)
        try {
          chatMsg.tool_calls = JSON.parse(m.tool_input);
        } catch { /* ignore parse errors */ }
      }
      return chatMsg;
    });
    set({ messages, currentSummary: detail.summary ?? null, summaryUpToMessageId: detail.summary_up_to_message_id ?? null });
    // Sync agent selection and load memory notes for this conversation's agent
    useSkillStore.getState().clear();
    if (detail.agent_id) {
      useAgentStore.getState().selectAgent(detail.agent_id);
      useMemoryStore.getState().loadNotes(detail.agent_id);
      // Load skills for this agent
      const agent = useAgentStore.getState().agents.find((a) => a.id === detail.agent_id);
      if (agent) {
        await useSkillStore.getState().loadSkills(agent.folder_name);
        if (detail.active_skills && Array.isArray(detail.active_skills) && detail.active_skills.length > 0) {
          await useSkillStore.getState().restoreActiveSkills(agent.folder_name, detail.active_skills);
        }
      }
    }
    // Load debug logs for this conversation
    useDebugStore.getState().loadLogs(id);
  },

  createNewConversation: () => {
    set({ currentConversationId: null, messages: [], activeRun: null, currentSummary: null, summaryUpToMessageId: null, summaryJobId: null, ...TOOL_RESET, ...BOOTSTRAP_RESET });
    useAgentStore.getState().selectAgent(null);
    useDebugStore.getState().clear();
    useSkillStore.getState().clear();
  },

  prepareForAgent: (agentId: string) => {
    set({ currentConversationId: null, messages: [], activeRun: null, currentSummary: null, summaryUpToMessageId: null, summaryJobId: null, ...TOOL_RESET, ...BOOTSTRAP_RESET });
    useAgentStore.getState().selectAgent(agentId);
    useSkillStore.getState().clear();
    // Load skills for the selected agent
    const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
    if (agent) {
      useSkillStore.getState().loadSkills(agent.folder_name);
    }
  },

  deleteConversation: async (id) => {
    await cmds.deleteConversation(id);
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      set({ currentConversationId: null, messages: [], currentSummary: null, summaryUpToMessageId: null, summaryJobId: null });
      useAgentStore.getState().selectAgent(null);
    }
    await get().loadConversations();
  },

  // ── Bootstrap mode ──────────────────────────────────

  startBootstrap: async () => {
    const folderName = `agent-${Date.now()}`;

    let prompt: string;
    try {
      prompt = await cmds.getBootstrapPrompt();
    } catch {
      console.error("Failed to load bootstrap prompt");
      return;
    }

    set({
      isBootstrapping: true,
      bootstrapFolderName: folderName,
      bootstrapApiHistory: [{ role: "system", content: prompt }],
      bootstrapFilesWritten: [],
      currentConversationId: null,
      messages: [],
      inputValue: "",
      currentSummary: null,
      summaryUpToMessageId: null,
      summaryJobId: null,
    });
  },

  cancelBootstrap: () => {
    set({ ...BOOTSTRAP_RESET, messages: [], currentSummary: null, summaryUpToMessageId: null, summaryJobId: null });
    useAgentStore.getState().selectAgent(null);
  },

  // ── Send message ────────────────────────────────────

  sendMessage: async () => {
    const { inputValue, isBootstrapping } = get();
    if (!inputValue.trim()) return;

    // Wait for env defaults to load before checking API key
    await useSettingsStore.getState().waitForEnv();

    // Common API key guard
    const settings = useSettingsStore.getState();
    if (!settings.hasApiKey) {
      settings.setIsSettingsOpen(true);
      return;
    }

    // Slash command: /특기 or /skill
    const trimmed = inputValue.trim();
    if (trimmed.startsWith("/특기") || trimmed.startsWith("/skill")) {
      await handleSkillCommand(trimmed, set, get);
      return;
    }

    if (isBootstrapping) {
      await sendBootstrapMessage(set, get);
    } else {
      await sendNormalMessage(set, get);
    }
  },
}));

// ── Skill slash command handler ──────────────────────

async function handleSkillCommand(
  command: string,
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const skillStore = useSkillStore.getState();
  const { currentConversationId, conversations } = get();

  const parts = command.split(/\s+/);
  const subCommand = parts[1];
  const skillName = parts.slice(2).join(" ");

  let resultMessage = "";

  if (!subCommand) {
    // /특기 — list all
    const available = skillStore.availableSkills;
    const active = skillStore.activeSkillNames;
    resultMessage =
      `**사용 가능한 특기:**\n${
        available
          .map(
            (s) =>
              `- ${active.includes(s.name) ? "\u2705" : "\u2B1C"} ${s.name}: ${s.description}`,
          )
          .join("\n") || "(없음)"
      }\n\n활성: ${active.length}개 | 토큰: ~${skillStore.activeSkillTokens}/2000`;
  } else if ((subCommand === "장착" || subCommand === "on") && skillName) {
    const conv = conversations.find((c) => c.id === currentConversationId);
    const agentId = conv?.agent_id ?? useAgentStore.getState().selectedAgentId;
    const agent = agentId
      ? useAgentStore.getState().agents.find((a) => a.id === agentId)
      : null;
    if (agent) {
      const success = await skillStore.activateSkill(
        agent.folder_name,
        skillName,
        currentConversationId ?? undefined,
      );
      resultMessage = success
        ? `\u2705 특기 "${skillName}" 장착 완료 (~${skillStore.activeSkillTokens}/2000 토큰)`
        : `\u274C 특기 "${skillName}" 장착 실패 (토큰 한도 초과 또는 존재하지 않음)`;
    } else {
      resultMessage = "\u274C 현재 에이전트를 찾을 수 없습니다";
    }
  } else if ((subCommand === "해제" || subCommand === "off") && skillName) {
    await skillStore.deactivateSkill(
      skillName,
      currentConversationId ?? undefined,
    );
    resultMessage = `특기 "${skillName}" 해제 완료`;
  } else {
    resultMessage =
      "사용법: /특기 [장착|해제] [이름]\n예: /특기 장착 code-review";
  }

  const sysMsg: ChatMessage = {
    id: `skill-cmd-${Date.now()}`,
    type: "agent",
    content: resultMessage,
    status: "complete",
  };
  set({ messages: [...get().messages, sysMsg], inputValue: "" });
}

// ── Tool approval mechanism ────────────────────────────
let _toolApprovalResolve: ((approved: boolean) => void) | null = null;
const TOOL_APPROVAL_TIMEOUT_MS = 60_000;

function waitForToolApproval(): Promise<boolean> {
  return new Promise((resolve) => {
    _toolApprovalResolve = resolve;
    // Auto-reject after 60 seconds
    setTimeout(() => {
      if (_toolApprovalResolve === resolve) {
        _toolApprovalResolve = null;
        resolve(false);
      }
    }, TOOL_APPROVAL_TIMEOUT_MS);
  });
}

// ── Stream one turn (extracted helper) ─────────────────

async function streamOneTurn(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  params: {
    baseSystemPrompt: string;
    effective: { model: string; temperature: number | null; thinkingEnabled: boolean; thinkingBudget: number | null };
    requestId: string;
    msgId: string;
    tools?: object[];
    skillsSection?: string;
  },
): Promise<StreamDoneEvent> {
  const { baseSystemPrompt, effective, requestId, msgId, tools, skillsSection } = params;

  // Build conversation context each iteration (messages may have grown with tool results)
  const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
    messages: get().messages,
    summary: get().currentSummary,
    baseSystemPrompt,
    skillsSection,
    memoryNotes: useMemoryStore.getState().notes,
  });

  // rAF-based chunk coalescing
  let pendingDelta = "";
  let pendingReasoning = "";
  let rafId: number | null = null;

  const flushDelta = () => {
    if (!pendingDelta && !pendingReasoning) return;
    const delta = pendingDelta;
    pendingDelta = "";
    pendingReasoning = "";

    set({
      messages: get().messages.map((m) =>
        m.id === msgId
          ? {
              ...m,
              content: m.content === LOADING_MESSAGE ? delta : m.content + delta,
              status: "streaming" as const,
            }
          : m,
      ),
      activeRun: get().activeRun ? { ...get().activeRun!, status: "streaming" } : null,
    });
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
      messages: chatMessages as Record<string, unknown>[],
      system_prompt: systemPrompt,
      model: effective.model,
      temperature: effective.temperature,
      thinking_enabled: effective.thinkingEnabled,
      thinking_budget: effective.thinkingBudget,
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

// ── Execute tool calls via Rust backend ────────────────

async function executeToolCalls(
  toolCalls: ToolCall[],
  conversationId: string,
): Promise<ChatMessage[]> {
  const results: ChatMessage[] = [];
  for (const tc of toolCalls) {
    try {
      const result = await cmds.executeTool(tc.name, tc.arguments, conversationId);
      results.push({
        id: `tool-result-${Date.now()}-${tc.id}`,
        type: "tool",
        content: result.output,
        status: "complete",
        tool_call_id: tc.id,
        tool_name: tc.name,
      });
    } catch (error) {
      results.push({
        id: `tool-error-${Date.now()}-${tc.id}`,
        type: "tool",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        status: "complete",
        tool_call_id: tc.id,
        tool_name: tc.name,
      });
    }
  }
  return results;
}

// ── Normal message flow ────────────────────────────────

async function sendNormalMessage(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const { inputValue, currentConversationId, messages, conversations } = get();
  const settings = useSettingsStore.getState();

  // Determine agent
  const agentStore = useAgentStore.getState();
  let agentId: string | null = null;
  let agent = null;

  if (currentConversationId) {
    const conv = conversations.find((c) => c.id === currentConversationId);
    agentId = conv?.agent_id ?? null;
  } else {
    agentId = agentStore.selectedAgentId;
  }

  if (agentId) {
    agent = agentStore.agents.find((a) => a.id === agentId) ?? null;
  }

  // Ensure skills are loaded for the agent before building prompt
  if (agent && useSkillStore.getState().availableSkills.length === 0) {
    await useSkillStore.getState().loadSkills(agent.folder_name);
  }

  // Auto-create conversation
  let convId = currentConversationId;
  let initialTitle: string | null = null; // Track for title-write guard
  if (!convId) {
    if (!agentId) {
      console.error("No agent selected for new conversation");
      return;
    }
    initialTitle =
      inputValue.slice(0, CONVERSATION_TITLE_MAX_LENGTH) ||
      DEFAULT_CONVERSATION_TITLE;
    const conv = await cmds.createConversation(agentId, initialTitle);
    convId = conv.id;
    set({ currentConversationId: convId });

    // Persist any pre-activated skills to the new conversation (Issue 3)
    const skillNames = useSkillStore.getState().activeSkillNames;
    if (skillNames.length > 0) {
      await cmds.updateConversationSkills(convId, skillNames);
    }
  }

  // Save user message
  const savedUser = await cmds.saveMessage({
    conversation_id: convId,
    role: "user",
    content: inputValue,
  });

  const userMsg: ChatMessage = {
    id: savedUser.id,
    dbMessageId: savedUser.id,
    type: "user",
    content: inputValue,
    status: "complete",
  };

  let currentRequestId = `req-${Date.now()}`;
  const { msgId: firstMsgId, msg: pendingMsg } = createPendingMessage(currentRequestId);
  let currentMsgId = firstMsgId;

  set({
    messages: [...messages, userMsg, pendingMsg],
    inputValue: "",
    activeRun: {
      requestId: currentRequestId,
      conversationId: convId,
      targetMessageId: currentMsgId,
      status: "pending",
    },
  });

  try {
    // Build base system prompt
    let baseSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (agent) {
      try {
        const files = await readPersonaFiles(agent.folder_name);
        baseSystemPrompt = agent.is_default
          ? assembleManagerPrompt(files, agentStore.agents)
          : assembleSystemPrompt(files);
      } catch {
        // Fallback to default
      }
    }

    const effective = agent
      ? getEffectiveSettings(agent)
      : {
          model: settings.modelName,
          temperature: null as number | null,
          thinkingEnabled: settings.thinkingEnabled,
          thinkingBudget: settings.thinkingBudget,
        };

    // Load tools for agent
    let toolDefinitions: ToolDefinition[] = [];
    if (agent && !agent.is_default) {
      try {
        toolDefinitions = await getToolsForAgent(agent.folder_name);
      } catch { /* no tools */ }
    }
    const openAITools = toolDefinitions.length > 0 ? toOpenAITools(toolDefinitions) : undefined;

    // Get active skills prompt section
    const skillsSection = useSkillStore.getState().getSkillsPromptSection();

    // ── Tool iteration loop ──
    let iterationCount = 0;

    while (iterationCount <= MAX_TOOL_ITERATIONS) {
      const done = await streamOneTurn(set, get, {
        baseSystemPrompt,
        effective,
        requestId: currentRequestId,
        msgId: currentMsgId,
        tools: openAITools,
        skillsSection,
      });

      if (done.error) {
        if (done.error === "aborted") {
          set({
            messages: updateMessage(get().messages, currentMsgId, { status: "aborted" }),
            activeRun: null,
            ...TOOL_RESET,
          });
          break;
        }
        throw new Error(done.error);
      }

      const replyContent = done.full_content || "";
      const reasoningContent = done.reasoning_content ?? undefined;
      const toolCalls = done.tool_calls;

      // No tool calls → normal completion
      if (!toolCalls || toolCalls.length === 0) {
        const finalContent = replyContent || NO_RESPONSE_MESSAGE;
        const savedAssistant = await cmds.saveMessage({
          conversation_id: convId,
          role: "assistant",
          content: finalContent,
        });

        set({
          messages: updateMessage(get().messages, currentMsgId, {
            dbMessageId: savedAssistant.id,
            content: finalContent,
            reasoningContent,
            status: "complete",
          }),
          activeRun: null,
          ...TOOL_RESET,
        });

        // Auto-generate title on first assistant message
        const completedAgentMsgs = get().messages.filter((m) => m.type === "agent" && m.status === "complete");
        if (completedAgentMsgs.length === 1) {
          const expectedTitle = initialTitle ?? get().conversations.find((c) => c.id === convId)?.title ?? null;
          generateTitle(convId, inputValue, finalContent, expectedTitle, get, set);
        }

        maybeGenerateSummary(convId, baseSystemPrompt, get, set);
        break;
      }

      // ── Has tool calls → enter tool execution ──
      iterationCount++;
      if (iterationCount > MAX_TOOL_ITERATIONS) {
        set({
          messages: updateMessage(get().messages, currentMsgId, {
            content: replyContent || "최대 도구 호출 반복 횟수에 도달했습니다.",
            status: "failed",
          }),
          activeRun: null,
          ...TOOL_RESET,
        });
        break;
      }

      const parsedToolCalls: ToolCall[] = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      // Save assistant message with tool_calls to DB
      const savedAssistant = await cmds.saveMessage({
        conversation_id: convId,
        role: "assistant",
        content: replyContent,
        tool_name: "tool_calls",
        tool_input: JSON.stringify(parsedToolCalls),
      });

      set({
        messages: updateMessage(get().messages, currentMsgId, {
          dbMessageId: savedAssistant.id,
          content: replyContent,
          reasoningContent,
          tool_calls: parsedToolCalls,
          status: "complete",
        }),
        toolRunState: "tool_pending",
        pendingToolCalls: parsedToolCalls,
        toolIterationCount: iterationCount,
      });

      // Per-tool permission handling: each tool call evaluated individually
      let savedToolMsgs: ChatMessage[] = [];
      const autoTools: ToolCall[] = [];
      const confirmTools: ToolCall[] = [];
      const denyTools: ToolCall[] = [];

      for (const tc of parsedToolCalls) {
        const tier = getToolTier(toolDefinitions, tc.name);
        if (tier === "deny") denyTools.push(tc);
        else if (tier === "confirm") confirmTools.push(tc);
        else autoTools.push(tc);
      }

      // 1. Persist deny results immediately
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

      // 2. Execute auto-tier tools immediately (no approval needed)
      if (autoTools.length > 0) {
        set({ toolRunState: "tool_running" });
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
        }
      }

      // 3. Ask user approval for confirm-tier tools (if any)
      if (confirmTools.length > 0) {
        set({ toolRunState: "tool_waiting", pendingToolCalls: confirmTools });
        const confirmApproved = await waitForToolApproval();
        if (confirmApproved) {
          set({ toolRunState: "tool_running" });
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

      // Prepare for next iteration — model will reflect on tool results (including denials)
      currentRequestId = `req-${Date.now()}`;
      const { msgId: nextMsgId, msg: nextPending } = createPendingMessage(currentRequestId);
      currentMsgId = nextMsgId;

      set({
        messages: [...get().messages, ...savedToolMsgs, nextPending],
        toolRunState: "continuing",
        activeRun: {
          requestId: currentRequestId,
          conversationId: convId,
          targetMessageId: currentMsgId,
          status: "pending",
        },
      });
    }
  } catch (error) {
    console.error("API Error:", error);
    set({
      messages: updateMessage(get().messages, currentMsgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
      activeRun: null,
      ...TOOL_RESET,
    });
  }

  await get().loadConversations();
}

// ── Regenerate stream flow ──────────────────────────────

async function regenerateStream(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  convId: string,
  truncated: ChatMessage[],
  lastUserContent: string,
) {
  const settings = useSettingsStore.getState();
  const agentStore = useAgentStore.getState();
  const conversations = get().conversations;

  // Determine agent
  const conv = conversations.find((c) => c.id === convId);
  const agentId = conv?.agent_id ?? null;
  const agent = agentId
    ? agentStore.agents.find((a) => a.id === agentId) ?? null
    : null;

  const requestId = `req-${Date.now()}`;
  const { msgId, msg: pendingMsg } = createPendingMessage(requestId);

  set({
    messages: [...truncated, pendingMsg],
    activeRun: {
      requestId,
      conversationId: convId,
      targetMessageId: msgId,
      status: "pending",
    },
  });

  try {
    // Build base system prompt
    let baseSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (agent) {
      try {
        const files = await readPersonaFiles(agent.folder_name);
        baseSystemPrompt = agent.is_default
          ? assembleManagerPrompt(files, agentStore.agents)
          : assembleSystemPrompt(files);
      } catch {
        // Fallback to default
      }
    }

    const effective = agent
      ? getEffectiveSettings(agent)
      : {
          model: settings.modelName,
          temperature: null as number | null,
          thinkingEnabled: settings.thinkingEnabled,
          thinkingBudget: settings.thinkingBudget,
        };

    // Build conversation context (shared path)
    const skillsSection = useSkillStore.getState().getSkillsPromptSection();
    const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
      messages: get().messages,
      summary: get().currentSummary,
      baseSystemPrompt,
      skillsSection,
      memoryNotes: useMemoryStore.getState().notes,
    });

    // rAF-based chunk coalescing
    let pendingDelta = "";
    let pendingReasoning = "";
    let rafId: number | null = null;

    const flushDelta = () => {
      if (!pendingDelta && !pendingReasoning) return;
      const delta = pendingDelta;
      pendingDelta = "";
      pendingReasoning = "";

      set({
        messages: get().messages.map((m) =>
          m.id === msgId
            ? {
                ...m,
                content: m.content === LOADING_MESSAGE ? delta : m.content + delta,
                status: "streaming" as const,
              }
            : m,
        ),
        activeRun: get().activeRun ? { ...get().activeRun!, status: "streaming" } : null,
      });
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
        messages: chatMessages,
        system_prompt: systemPrompt,
        model: effective.model,
        temperature: effective.temperature,
        thinking_enabled: effective.thinkingEnabled,
        thinking_budget: effective.thinkingBudget,
        request_id: requestId,
      });

      const done = await donePromise;

      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      flushDelta();

      if (done.error) {
        if (done.error === "aborted") {
          set({
            messages: updateMessage(get().messages, msgId, { status: "aborted" }),
            activeRun: null,
          });
        } else {
          throw new Error(done.error);
        }
      } else {
        const replyContent = done.full_content || NO_RESPONSE_MESSAGE;
        const reasoningContent = done.reasoning_content ?? undefined;

        const savedAssistant = await cmds.saveMessage({
          conversation_id: convId,
          role: "assistant",
          content: replyContent,
        });

        set({
          messages: updateMessage(get().messages, msgId, {
            dbMessageId: savedAssistant.id,
            content: replyContent,
            reasoningContent,
            status: "complete",
          }),
          activeRun: null,
        });

        // Auto-generate title on first assistant message
        const completedAgentMsgs = get().messages.filter((m) => m.type === "agent" && m.status === "complete");
        if (completedAgentMsgs.length === 1) {
          const currentTitle = get().conversations.find((c) => c.id === convId)?.title;
          generateTitle(convId, lastUserContent, replyContent, currentTitle ?? null, get, set);
        }

        // Background summary generation (pass actual system prompt for accurate budget)
        maybeGenerateSummary(convId, baseSystemPrompt, get, set);
      }
    } finally {
      unlistenChunk();
      unlistenDone();
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }
  } catch (error) {
    console.error("Regenerate Error:", error);
    set({
      messages: updateMessage(get().messages, msgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
      activeRun: null,
    });
  }

  await get().loadConversations();
}

// ── Bootstrap message flow ─────────────────────────────

async function sendBootstrapMessage(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const {
    inputValue,
    messages,
    bootstrapApiHistory,
    bootstrapFolderName,
    bootstrapFilesWritten,
  } = get();

  const settings = useSettingsStore.getState();
  if (!bootstrapFolderName) return;

  const userMsg: ChatMessage = {
    id: `user-${Date.now()}`,
    type: "user",
    content: inputValue,
    status: "complete",
  };

  const { msgId, msg: pendingMsg } = createPendingMessage();
  set({ messages: [...messages, userMsg, pendingMsg], inputValue: "" });

  try {
    const result = await executeBootstrapTurn(
      bootstrapApiHistory,
      inputValue,
      bootstrapFolderName,
      settings.modelName,
    );

    const allFilesWritten = [...bootstrapFilesWritten];
    for (const f of result.filesWritten) {
      if (!allFilesWritten.includes(f)) allFilesWritten.push(f);
    }

    set({
      bootstrapApiHistory: result.apiMessages,
      bootstrapFilesWritten: allFilesWritten,
      messages: updateMessage(get().messages, msgId, {
        id: `resp-${Date.now()}`,
        content: result.responseText,
        status: "complete",
      }),
    });

    if (isBootstrapComplete(allFilesWritten)) {
      await completeBootstrap(set, get);
    }
  } catch (error) {
    console.error("Bootstrap API Error:", error);
    set({
      messages: updateMessage(get().messages, msgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }
}

async function completeBootstrap(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const { bootstrapFolderName } = get();
  if (!bootstrapFolderName) return;

  // Bootstrap wrote files directly via IPC — invalidate any stale cache
  invalidatePersonaCache(bootstrapFolderName);

  // Write default TOOLS.md if not already present
  try {
    await cmds.readAgentFile(bootstrapFolderName, "TOOLS.md");
    // File exists — don't overwrite
  } catch {
    try {
      await cmds.writeAgentFile(bootstrapFolderName, "TOOLS.md", DEFAULT_TOOLS_MD);
    } catch (e) {
      console.warn("Failed to write default TOOLS.md:", e);
    }
  }

  let agentName: string;
  try {
    const identity = await cmds.readAgentFile(
      bootstrapFolderName,
      "IDENTITY.md",
    );
    agentName = parseAgentName(identity);
  } catch {
    agentName = DEFAULT_AGENT_NAME;
  }

  try {
    const agent = await cmds.createAgent({
      folder_name: bootstrapFolderName,
      name: agentName,
    });

    set({ ...BOOTSTRAP_RESET, messages: [], currentSummary: null, summaryUpToMessageId: null, summaryJobId: null });

    const agentStore = useAgentStore.getState();
    await agentStore.loadAgents();
    agentStore.selectAgent(agent.id);
  } catch (error) {
    console.error("Failed to complete bootstrap:", error);
    const errorMsg: ChatMessage = {
      id: `error-${Date.now()}`,
      type: "agent",
      content: `에이전트 생성에 실패했습니다: ${error}. 다시 시도하거나 취소 버튼을 눌러주세요.`,
      status: "failed",
    };
    set({ messages: [...get().messages, errorMsg] });
  }
}

// ── Title generation (fire-and-forget) ──────────────

async function generateTitle(
  convId: string,
  userMsg: string,
  assistantMsg: string,
  expectedCurrentTitle: string | null,
  get: () => ChatState,
  _set: (partial: Partial<ChatState>) => void,
) {
  try {
    const settings = useSettingsStore.getState();
    const resp = await cmds.chatCompletion({
      messages: [
        { role: "system", content: TITLE_GENERATION_PROMPT },
        { role: "user", content: `User: ${userMsg}\nAssistant: ${assistantMsg}` },
      ],
      system_prompt: "",
      model: settings.modelName,
      thinking_enabled: false,
      thinking_budget: null,
    });
    const title = resp.content.trim().replace(/^["']|["']$/g, "").slice(0, 50) || DEFAULT_CONVERSATION_TITLE;
    // Title-write guard: only overwrite if title is still the original truncated value
    await cmds.updateConversationTitle(convId, title, expectedCurrentTitle);
    await get().loadConversations();
  } catch {
    // Silently ignore — title is non-critical
  }
}

// ── Summary generation (fire-and-forget) ──────────────

async function maybeGenerateSummary(
  convId: string,
  baseSystemPrompt: string,
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
) {
  const allMessages = get().messages.filter((m) => m.status === "complete");
  const totalTokens = allMessages.reduce(
    (sum, m) => sum + estimateMessageTokens({ role: m.type === "user" ? "user" : "assistant", content: m.content }), 0,
  );

  // Use actual assembled system prompt for budget calculation (fix: dynamic reserve)
  const systemTokens = estimateTokens(get().currentSummary
    ? `${baseSystemPrompt}\n\n[이전 대화 요약]\n${get().currentSummary}\n\n[최근 대화는 아래에 이어집니다]`
    : baseSystemPrompt);
  const budget = MAX_CONTEXT_TOKENS - systemTokens;
  if (totalTokens < budget * 0.8) return;

  // Determine which messages would be dropped by token-based selection
  const selected = buildChatMessages(allMessages, systemTokens, 0);
  const selectedCount = selected.length;
  const excluded = allMessages.slice(0, allMessages.length - selectedCount);
  if (excluded.length === 0) return;

  // Delta-only: skip messages already covered by existing summary (fix: avoid re-summarizing)
  const currentUpToId = get().summaryUpToMessageId;
  let deltaStart = 0;
  if (currentUpToId) {
    const checkpointIdx = excluded.findIndex((m) => m.dbMessageId === currentUpToId);
    if (checkpointIdx >= 0) {
      deltaStart = checkpointIdx + 1; // start after the checkpoint
    }
  }
  const newExcluded = excluded.slice(deltaStart);
  if (newExcluded.length === 0) return; // no new messages to summarize

  // Version guard
  const jobId = `summary-${Date.now()}`;
  const expectedPrevious = get().summaryUpToMessageId;
  set({ summaryJobId: jobId });

  const existingSummary = get().currentSummary || "";
  const toSummarize = newExcluded
    .map((m) => `${m.type === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  try {
    const settings = useSettingsStore.getState();
    const resp = await cmds.chatCompletion({
      messages: [
        { role: "system", content: SUMMARY_GENERATION_PROMPT },
        { role: "user", content: `이전 요약:\n${existingSummary}\n\n새 메시지:\n${toSummarize}` },
      ],
      system_prompt: "",
      model: settings.modelName,
      thinking_enabled: false,
      thinking_budget: null,
    });

    // Stale guards
    if (get().summaryJobId !== jobId) return;
    if (get().currentConversationId !== convId) return;

    const newSummary = resp.content.trim();
    const lastExcludedMsg = excluded[excluded.length - 1];
    const newUpToId = lastExcludedMsg.dbMessageId;
    if (!newUpToId) return;

    // Optimistic concurrency: backend saves only if expected matches
    const affected = await cmds.updateConversationSummary(
      convId, newSummary, newUpToId, expectedPrevious ?? null,
    );

    if (affected > 0) {
      set({ currentSummary: newSummary, summaryUpToMessageId: newUpToId });
    }
  } catch {
    // Silently ignore — retry on next turn
  }
}
