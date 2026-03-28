import { create } from "zustand";
import type { Attachment, ChatMessage } from "../services/types";

/** A pending image attachment (before saving to disk) with a data URL for preview. */
export interface PendingAttachment extends Attachment {
  dataUrl: string;  // data:image/... URL for preview rendering
}

interface MessageState {
  messages: ChatMessage[];
  inputValue: string;
  pendingAttachments: PendingAttachment[];

  setInputValue: (v: string) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  appendMessage: (msg: ChatMessage) => void;
  updateMessage: (targetId: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  copyMessage: (messageId: string) => void;
  addPendingAttachment: (att: PendingAttachment) => void;
  removePendingAttachment: (index: number) => void;
  clearPendingAttachments: () => void;
}

const MAX_PENDING_IMAGES = 4;

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: [],
  inputValue: "",
  pendingAttachments: [],

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

  addPendingAttachment: (att) => {
    const current = get().pendingAttachments;
    if (current.length >= MAX_PENDING_IMAGES) return;
    set({ pendingAttachments: [...current, att] });
  },

  removePendingAttachment: (index) => {
    set({ pendingAttachments: get().pendingAttachments.filter((_, i) => i !== index) });
  },

  clearPendingAttachments: () => set({ pendingAttachments: [] }),
}));
