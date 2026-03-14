import { create } from "zustand";
import OpenAI from "openai";
import type { Conversation, ChatMessage } from "../services/types";
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
  ERROR_MESSAGE,
  NO_RESPONSE_MESSAGE,
} from "../constants";

// ── Helpers ────────────────────────────────────────────

const BOOTSTRAP_RESET = {
  isBootstrapping: false,
  bootstrapFolderName: null as string | null,
  bootstrapApiHistory: [] as any[],
  bootstrapFilesWritten: [] as string[],
};

function createOpenAIClient(apiKey: string, baseUrl: string): OpenAI {
  const config: Record<string, unknown> = {
    apiKey,
    dangerouslyAllowBrowser: true,
  };
  if (baseUrl) {
    config.baseURL = baseUrl;
  }
  return new OpenAI(config as ConstructorParameters<typeof OpenAI>[0]);
}

function createLoadingMessage(): { loadingId: string; loadingMsg: ChatMessage } {
  const loadingId = `loading-${Date.now()}`;
  return {
    loadingId,
    loadingMsg: {
      id: loadingId,
      type: "agent",
      content: LOADING_MESSAGE,
      isLoading: true,
    },
  };
}

function replaceLoadingMessage(
  messages: ChatMessage[],
  loadingId: string,
  replacement: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((msg) =>
    msg.id === loadingId ? { ...msg, ...replacement } : msg,
  );
}

// ── Store ──────────────────────────────────────────────

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: ChatMessage[];
  inputValue: string;

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
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  inputValue: "",
  ...BOOTSTRAP_RESET,

  setInputValue: (v) => set({ inputValue: v }),

  loadConversations: async () => {
    const conversations = await cmds.getConversations();
    set({ conversations });
  },

  selectConversation: async (id) => {
    const dbMessages = await cmds.getMessages(id);
    const messages: ChatMessage[] = dbMessages.map((m) => ({
      id: m.id,
      type: m.role === "user" ? "user" : "agent",
      content: m.content,
    }));
    set({ currentConversationId: id, messages, ...BOOTSTRAP_RESET });
  },

  createNewConversation: () => {
    set({ currentConversationId: null, messages: [], ...BOOTSTRAP_RESET });
    useAgentStore.getState().selectAgent(null);
  },

  prepareForAgent: (agentId: string) => {
    set({ currentConversationId: null, messages: [], ...BOOTSTRAP_RESET });
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
    if (!settings.apiKey) {
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
    type: "user",
    content: inputValue,
  };

  const { loadingId, loadingMsg } = createLoadingMessage();
  set({ messages: [...messages, userMsg, loadingMsg], inputValue: "" });

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
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
        };

    const openai = createOpenAIClient(effective.apiKey, effective.baseUrl);
    const chatMessages = buildChatMessages(get().messages, systemPrompt);

    const requestParams: Record<string, unknown> = {
      model: effective.model,
      messages: chatMessages,
    };

    if (effective.temperature !== null) {
      requestParams.temperature = effective.temperature;
    }

    let response: any;
    let thinkingUsed = false;

    if (effective.thinkingEnabled) {
      try {
        response = await openai.chat.completions.create({
          ...requestParams,
          thinking: {
            type: "enabled",
            budget_tokens: effective.thinkingBudget,
          },
        } as any);
        thinkingUsed = true;
      } catch {
        response = await openai.chat.completions.create(requestParams as any);
      }
    } else {
      response = await openai.chat.completions.create(requestParams as any);
    }

    const choice = response.choices[0];
    const replyContent = choice?.message?.content || NO_RESPONSE_MESSAGE;
    const reasoningContent = thinkingUsed
      ? (choice?.message?.reasoning_content ?? undefined)
      : undefined;

    const savedAssistant = await cmds.saveMessage({
      conversation_id: convId,
      role: "assistant",
      content: replyContent,
    });

    set({
      messages: replaceLoadingMessage(get().messages, loadingId, {
        id: savedAssistant.id,
        content: replyContent,
        reasoningContent,
        isLoading: false,
      }),
    });
  } catch (error) {
    console.error("OpenAI API Error:", error);
    set({
      messages: replaceLoadingMessage(get().messages, loadingId, {
        content: ERROR_MESSAGE,
        isLoading: false,
      }),
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
  };

  const { loadingId, loadingMsg } = createLoadingMessage();
  set({ messages: [...messages, userMsg, loadingMsg], inputValue: "" });

  try {
    const openai = createOpenAIClient(settings.apiKey, settings.baseUrl);

    const result = await executeBootstrapTurn(
      bootstrapApiHistory,
      inputValue,
      bootstrapFolderName,
      openai,
      settings.modelName,
    );

    const allFilesWritten = [...bootstrapFilesWritten];
    for (const f of result.filesWritten) {
      if (!allFilesWritten.includes(f)) allFilesWritten.push(f);
    }

    set({
      bootstrapApiHistory: result.apiMessages,
      bootstrapFilesWritten: allFilesWritten,
      messages: replaceLoadingMessage(get().messages, loadingId, {
        id: `resp-${Date.now()}`,
        content: result.responseText,
        isLoading: false,
      }),
    });

    if (isBootstrapComplete(allFilesWritten)) {
      await completeBootstrap(set, get);
    }
  } catch (error) {
    console.error("Bootstrap API Error:", error);
    set({
      messages: replaceLoadingMessage(get().messages, loadingId, {
        content: ERROR_MESSAGE,
        isLoading: false,
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
    // 에이전트 생성 실패 시 사용자에게 에러를 보여주고 부트스트랩 상태 유지
    // (대화 내용 보존 — 사용자가 cancelBootstrap으로 직접 나갈 수 있음)
    const errorMsg: ChatMessage = {
      id: `error-${Date.now()}`,
      type: "agent",
      content: `에이전트 생성에 실패했습니다: ${error}. 다시 시도하거나 취소 버튼을 눌러주세요.`,
    };
    set({ messages: [...get().messages, errorMsg] });
  }
}
