import { create } from "zustand";
import OpenAI from "openai";
import type { Conversation, ChatMessage } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: ChatMessage[];
  inputValue: string;
  setInputValue: (v: string) => void;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createNewConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  inputValue: "",

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
    set({ currentConversationId: id, messages });
  },

  createNewConversation: () => {
    set({ currentConversationId: null, messages: [] });
  },

  deleteConversation: async (id) => {
    await cmds.deleteConversation(id);
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      set({ currentConversationId: null, messages: [] });
    }
    await get().loadConversations();
  },

  sendMessage: async () => {
    const { inputValue, currentConversationId, messages } = get();
    if (!inputValue.trim()) return;

    const settings = useSettingsStore.getState();
    if (!settings.apiKey) {
      settings.setIsSettingsOpen(true);
      return;
    }

    // Auto-create conversation if none selected
    let convId = currentConversationId;
    if (!convId) {
      const title = inputValue.slice(0, 50) || "새 대화";
      const conv = await cmds.createConversation(title);
      convId = conv.id;
      set({ currentConversationId: convId });
    }

    // Save user message to DB
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

    const loadingId = `loading-${Date.now()}`;
    const loadingMsg: ChatMessage = {
      id: loadingId,
      type: "agent",
      content: "생각 중...",
      isLoading: true,
    };

    set({ messages: [...messages, userMsg, loadingMsg], inputValue: "" });

    try {
      const config: Record<string, unknown> = {
        apiKey: settings.apiKey,
        dangerouslyAllowBrowser: true,
      };
      if (settings.baseUrl) {
        config.baseURL = settings.baseUrl;
      }

      const openai = new OpenAI(config as ConstructorParameters<typeof OpenAI>[0]);

      const currentMessages = get().messages;
      const history = currentMessages
        .filter((m) => !m.isLoading)
        .slice(-10)
        .map((m) => ({
          role: (m.type === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        }));

      const chatMessages = [
        {
          role: "system" as const,
          content:
            "You are a helpful and fully capable desktop AI assistant. Reply in a concise, friendly manner. Respond in the same language as the user's prompt (usually Korean).",
        },
        ...history,
      ];

      let response: any;
      let thinkingUsed = false;

      if (settings.thinkingEnabled) {
        // Try thinking mode, fallback to normal mode
        try {
          response = await openai.chat.completions.create({
            model: settings.modelName,
            messages: chatMessages,
            thinking: { type: "enabled", budget_tokens: settings.thinkingBudget },
          } as any);
          thinkingUsed = true;
        } catch {
          response = await openai.chat.completions.create({
            model: settings.modelName,
            messages: chatMessages,
          });
        }
      } else {
        response = await openai.chat.completions.create({
          model: settings.modelName,
          messages: chatMessages,
        });
      }

      const choice = response.choices[0];
      const replyContent = choice?.message?.content || "응답을 받지 못했습니다.";
      const reasoningContent = thinkingUsed
        ? (choice?.message?.reasoning_content ?? undefined)
        : undefined;

      // Save assistant message to DB
      const savedAssistant = await cmds.saveMessage({
        conversation_id: convId,
        role: "assistant",
        content: replyContent,
      });

      set({
        messages: get().messages.map((msg) =>
          msg.id === loadingId
            ? {
                ...msg,
                id: savedAssistant.id,
                content: replyContent,
                reasoningContent,
                isLoading: false,
              }
            : msg
        ),
      });
    } catch (error) {
      console.error("OpenAI API Error:", error);
      set({
        messages: get().messages.map((msg) =>
          msg.id === loadingId
            ? {
                ...msg,
                content: "API 호출 중 오류가 발생했습니다. API 키가 정확한지 확인해 주세요.",
                isLoading: false,
              }
            : msg
        ),
      });
    }

    // Refresh conversation list
    await get().loadConversations();
  },
}));
