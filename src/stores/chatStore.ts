import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { Conversation, ChatMessage, ActiveRun } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import { buildChatMessages } from "../services/chatHelpers";
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
      await cmds.deleteMessagesFrom(currentConversationId, targetMsg.dbMessageId);
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
    const dbMessages = await cmds.getMessages(id);
    const messages: ChatMessage[] = dbMessages.map((m) => ({
      id: m.id,
      dbMessageId: m.id,
      type: m.role === "user" ? "user" : "agent",
      content: m.content,
      status: "complete" as const,
    }));
    set({ currentConversationId: id, messages, activeRun: null, ...BOOTSTRAP_RESET });
  },

  createNewConversation: () => {
    set({ currentConversationId: null, messages: [], activeRun: null, ...BOOTSTRAP_RESET });
    useAgentStore.getState().selectAgent(null);
  },

  prepareForAgent: (agentId: string) => {
    set({ currentConversationId: null, messages: [], activeRun: null, ...BOOTSTRAP_RESET });
    useAgentStore.getState().selectAgent(agentId);
  },

  deleteConversation: async (id) => {
    await cmds.deleteConversation(id);
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      set({ currentConversationId: null, messages: [] });
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
    });
  },

  cancelBootstrap: () => {
    set({ ...BOOTSTRAP_RESET, messages: [] });
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
  if (!convId) {
    if (!agentId) {
      console.error("No agent selected for new conversation");
      return;
    }
    const title =
      inputValue.slice(0, CONVERSATION_TITLE_MAX_LENGTH) ||
      DEFAULT_CONVERSATION_TITLE;
    const conv = await cmds.createConversation(agentId, title);
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
    // Build system prompt
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (agent) {
      try {
        const files = await readPersonaFiles(agent.folder_name);
        systemPrompt = agent.is_default
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

    // Build messages for API (excluding pending message, system prompt handled by backend)
    const chatMessages = buildChatMessages(get().messages);

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
    // Build system prompt
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (agent) {
      try {
        const files = await readPersonaFiles(agent.folder_name);
        systemPrompt = agent.is_default
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

    const chatMessages = buildChatMessages(get().messages);

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

    set({ ...BOOTSTRAP_RESET, messages: [] });

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
