import { create } from "zustand";
import type { Message, Channel } from "../services/types";
import {
  getChannels,
  getMessages,
  sendMessage,
  chatWithAgent,
  listenChatStream,
  getAgentResponse,
} from "../services/tauriCommands";

interface ChatState {
  channels: Channel[];
  activeChannelId: string | null;
  messages: Message[];
  streaming: boolean;
  streamingContent: string;
  fetchChannels: () => Promise<void>;
  setActiveChannel: (channelId: string) => Promise<void>;
  send: (content: string) => Promise<void>;
  initStreamListener: () => Promise<void>;
  cleanupStreamListener: () => void;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Module-level variable to track the stream listener unlisten function
let streamUnlistenFn: (() => void) | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  channels: [],
  activeChannelId: null,
  messages: [],
  streaming: false,
  streamingContent: "",

  fetchChannels: async () => {
    const channels = await getChannels();
    set({ channels });
  },

  setActiveChannel: async (channelId: string) => {
    set({ activeChannelId: channelId });
    const messages = await getMessages(channelId);
    set({ messages });
  },

  send: async (content: string) => {
    const { activeChannelId } = get();
    if (!activeChannelId) return;

    if (isTauri()) {
      // In Tauri mode, add user message to local state optimistically.
      // Do NOT call sendMessage() here because chatWithAgent() already
      // saves the user message to DB, which would cause a duplicate insert.
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        channelId: activeChannelId,
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };
      set((state) => ({
        messages: [...state.messages, userMsg],
        streaming: true,
        streamingContent: "",
      }));

      // Find the agent for this channel
      const channel = get().channels.find((c) => c.id === activeChannelId);
      const agentId = channel?.agentId || activeChannelId;

      try {
        const result = await chatWithAgent(agentId, content);

        // After streaming completes, add the full message
        if (result.success && result.message) {
          const assistantMsg: Message = {
            id: `msg-${Date.now()}`,
            channelId: activeChannelId,
            role: "assistant",
            content: result.message,
            timestamp: new Date().toISOString(),
            agentId,
          };
          set((state) => ({
            messages: [...state.messages, assistantMsg],
            streaming: false,
            streamingContent: "",
          }));
        } else {
          // Error - show error message
          const errorMsg: Message = {
            id: `msg-${Date.now()}`,
            channelId: activeChannelId,
            role: "assistant",
            content: `오류가 발생했습니다: ${result.error || "알 수 없는 오류"}`,
            timestamp: new Date().toISOString(),
            agentId,
          };
          set((state) => ({
            messages: [...state.messages, errorMsg],
            streaming: false,
            streamingContent: "",
          }));
        }
      } catch (err) {
        set({
          streaming: false,
          streamingContent: "",
        });
        console.error("Chat error:", err);
      }
    } else {
      // Fallback to mock responses (non-Tauri): use sendMessage to add to mock store
      const userMsg = await sendMessage(activeChannelId, content);
      set((state) => ({ messages: [...state.messages, userMsg], streaming: true }));
      const response = await getAgentResponse(activeChannelId, content);
      set((state) => ({
        messages: [...state.messages, response],
        streaming: false,
      }));
    }
  },

  initStreamListener: async () => {
    if (streamUnlistenFn) return; // Already registered, prevent duplicate
    streamUnlistenFn = await listenChatStream((payload) => {
      if (payload.done) {
        return; // The send() function handles the final message
      }
      set((state) => ({
        streamingContent: state.streamingContent + payload.chunk,
      }));
    });
  },

  cleanupStreamListener: () => {
    if (streamUnlistenFn) {
      streamUnlistenFn();
      streamUnlistenFn = null;
    }
  },
}));
