import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { Conversation, ChatMessage, ActiveRun } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
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
} from "../constants";

// ── Stream event types ────────────────────────────────
type StreamChunkEvent = { request_id: string; delta: string; reasoning_delta: string | null };
type StreamDoneEvent = { request_id: string; full_content: string; reasoning_content: string | null; error: string | null };

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
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  inputValue: "",
  activeRun: null,
  currentSummary: null,
  summaryUpToMessageId: null,
  summaryJobId: null,
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

  loadConversations: async () => {
    const conversations = await cmds.getConversations();
    set({ conversations });
  },

  selectConversation: async (id) => {
    set({ currentConversationId: id, messages: [], activeRun: null, currentSummary: null, summaryUpToMessageId: null, summaryJobId: null, ...BOOTSTRAP_RESET });
    const [detail, dbMessages] = await Promise.all([
      cmds.getConversationDetail(id),
      cmds.getMessages(id),
    ]);
    if (get().currentConversationId !== id) return; // stale guard
    const messages: ChatMessage[] = dbMessages.map((m) => ({
      id: m.id,
      dbMessageId: m.id,
      type: m.role === "user" ? "user" : "agent",
      content: m.content,
      status: "complete" as const,
    }));
    set({ messages, currentSummary: detail.summary ?? null, summaryUpToMessageId: detail.summary_up_to_message_id ?? null });
  },

  createNewConversation: () => {
    set({ currentConversationId: null, messages: [], activeRun: null, currentSummary: null, summaryUpToMessageId: null, summaryJobId: null, ...BOOTSTRAP_RESET });
    useAgentStore.getState().selectAgent(null);
  },

  prepareForAgent: (agentId: string) => {
    set({ currentConversationId: null, messages: [], activeRun: null, currentSummary: null, summaryUpToMessageId: null, summaryJobId: null, ...BOOTSTRAP_RESET });
    useAgentStore.getState().selectAgent(agentId);
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

    if (isBootstrapping) {
      await sendBootstrapMessage(set, get);
    } else {
      await sendNormalMessage(set, get);
    }
  },
}));

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

  const requestId = `req-${Date.now()}`;
  const { msgId, msg: pendingMsg } = createPendingMessage(requestId);

  set({
    messages: [...messages, userMsg, pendingMsg],
    inputValue: "",
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
    const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
      messages: get().messages,
      summary: get().currentSummary,
      baseSystemPrompt,
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

    // Register BOTH listeners before starting the stream (fix: done-listener race)
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
      // Start streaming
      await cmds.chatCompletionStream({
        messages: chatMessages,
        system_prompt: systemPrompt,
        model: effective.model,
        temperature: effective.temperature,
        thinking_enabled: effective.thinkingEnabled,
        thinking_budget: effective.thinkingBudget,
        request_id: requestId,
      });

      // Wait for completion
      const done = await donePromise;

      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      flushDelta();

      if (done.error) {
        if (done.error === "aborted") {
          set({
            messages: updateMessage(get().messages, msgId, { status: "aborted" }),
            activeRun: null,
          });
          // Don't throw — fall through to loadConversations below
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
          // Use captured initialTitle for new convs, or look up existing title
          const expectedTitle = initialTitle ?? get().conversations.find((c) => c.id === convId)?.title ?? null;
          generateTitle(convId, inputValue, replyContent, expectedTitle, get, set);
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
    console.error("API Error:", error);
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
    const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
      messages: get().messages,
      summary: get().currentSummary,
      baseSystemPrompt,
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
  set: (partial: Partial<ChatState>) => void,
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
