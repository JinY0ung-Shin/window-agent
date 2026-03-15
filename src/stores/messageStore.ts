import { create } from "zustand";
import type { ChatMessage } from "../services/types";

interface MessageState {
  messages: ChatMessage[];
  inputValue: string;

  setInputValue: (v: string) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  appendMessage: (msg: ChatMessage) => void;
  updateMessage: (targetId: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  copyMessage: (messageId: string) => void;
}

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: [],
  inputValue: "",

  setInputValue: (v) => set({ inputValue: v }),

  setMessages: (msgs) => set({ messages: msgs }),

  appendMessage: (msg) => set({ messages: [...get().messages, msg] }),

  updateMessage: (targetId, updates) =>
    set({
      messages: get().messages.map((msg) =>
        msg.id === targetId ? { ...msg, ...updates } : msg,
      ),
    }),

  clearMessages: () => set({ messages: [] }),

  copyMessage: (messageId) => {
    const msg = get().messages.find((m) => m.id === messageId);
    if (msg) navigator.clipboard.writeText(msg.content);
  },
}));
