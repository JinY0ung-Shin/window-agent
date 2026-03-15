/**
 * chatStore — backward-compatible facade
 *
 * All state and logic is now owned by individual stores:
 *   conversationStore, messageStore, streamStore,
 *   summaryStore, bootstrapStore, toolRunStore, chatFlowStore
 *
 * This file re-exports a unified useChatStore that mirrors the original API
 * so existing components and tests work without changes.
 */

import { create } from "zustand";
import type { Conversation, ChatMessage, ActiveRun, ToolCall, ToolRunState } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useConversationStore } from "./conversationStore";
import { useMessageStore } from "./messageStore";
import { useSummaryStore } from "./summaryStore";
import { useBootstrapStore } from "./bootstrapStore";
import { useToolRunStore } from "./toolRunStore";
import { useChatFlowStore } from "./chatFlowStore";

// ── ChatState interface (unchanged from original) ──────────

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

// ── Facade store ──────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  // ── State fields (synced from leaf stores via subscriptions) ──
  conversations: [],
  currentConversationId: null,
  messages: [],
  inputValue: "",
  activeRun: null,
  currentSummary: null,
  summaryUpToMessageId: null,
  summaryJobId: null,
  toolRunState: "idle" as ToolRunState,
  pendingToolCalls: [] as ToolCall[],
  toolIterationCount: 0,
  isBootstrapping: false,
  bootstrapFolderName: null,
  bootstrapApiHistory: [] as any[],
  bootstrapFilesWritten: [] as string[],

  // ── Actions (delegate to leaf stores) ──

  setInputValue: (v) => set({ inputValue: v }),

  copyMessage: (messageId) => {
    const msg = get().messages.find((m) => m.id === messageId);
    if (msg) navigator.clipboard.writeText(msg.content);
  },

  loadConversations: async () => {
    await useConversationStore.getState().loadConversations();
    set({ conversations: useConversationStore.getState().conversations });
  },

  selectConversation: async (id) => {
    set({
      currentConversationId: id, messages: [], activeRun: null,
      currentSummary: null, summaryUpToMessageId: null, summaryJobId: null,
      toolRunState: "idle", pendingToolCalls: [], toolIterationCount: 0,
      isBootstrapping: false, bootstrapFolderName: null,
      bootstrapApiHistory: [], bootstrapFilesWritten: [],
    });
    const result: any = await useConversationStore.getState().selectConversation(id);
    if (get().currentConversationId !== id) return; // stale guard
    if (result?.messages) {
      const ss = useSummaryStore.getState();
      set({
        messages: result.messages,
        currentSummary: ss.currentSummary,
        summaryUpToMessageId: ss.summaryUpToMessageId,
      });
    }
  },

  createNewConversation: () => {
    set({
      currentConversationId: null, messages: [], activeRun: null,
      currentSummary: null, summaryUpToMessageId: null, summaryJobId: null,
      toolRunState: "idle", pendingToolCalls: [], toolIterationCount: 0,
      isBootstrapping: false, bootstrapFolderName: null,
      bootstrapApiHistory: [], bootstrapFilesWritten: [],
    });
    useConversationStore.getState().createNewConversation();
    useSummaryStore.getState().resetSummary();
  },

  prepareForAgent: (agentId) => {
    useChatFlowStore.getState().prepareForAgent(agentId);
  },

  deleteConversation: async (id) => {
    await useConversationStore.getState().deleteConversation(id);
    const cs = useConversationStore.getState();
    if (get().currentConversationId === id) {
      set({
        currentConversationId: null, messages: [],
        currentSummary: null, summaryUpToMessageId: null, summaryJobId: null,
      });
    }
    set({ conversations: cs.conversations });
  },

  startBootstrap: async () => {
    await useBootstrapStore.getState().startBootstrap();
    const bs = useBootstrapStore.getState();
    set({
      isBootstrapping: bs.isBootstrapping,
      bootstrapFolderName: bs.bootstrapFolderName,
      bootstrapApiHistory: bs.bootstrapApiHistory,
      bootstrapFilesWritten: bs.bootstrapFilesWritten,
      currentConversationId: null,
      messages: [],
      inputValue: "",
      currentSummary: null,
      summaryUpToMessageId: null,
      summaryJobId: null,
    });
    useSummaryStore.getState().resetSummary();
  },

  cancelBootstrap: () => {
    useBootstrapStore.getState().cancelBootstrap(); // also calls selectAgent(null)
    useSummaryStore.getState().resetSummary();
    set({
      isBootstrapping: false, bootstrapFolderName: null,
      bootstrapApiHistory: [], bootstrapFilesWritten: [],
      messages: [],
      currentSummary: null, summaryUpToMessageId: null, summaryJobId: null,
    });
  },

  sendMessage: async () => {
    await useChatFlowStore.getState().sendMessage();
  },

  regenerateMessage: async (messageId) => {
    await useChatFlowStore.getState().regenerateMessage(messageId);
  },

  abortStream: async () => {
    const { activeRun } = get();
    if (!activeRun) return;
    await cmds.abortStream(activeRun.requestId);
  },

  approveToolCall: async () => {
    useToolRunStore.getState().approveToolCall();
    set({ toolRunState: "tool_running" });
  },

  rejectToolCall: () => {
    useToolRunStore.getState().rejectToolCall();
  },
}));

// ── Bidirectional sync: chatStore ↔ leaf stores ──────────

let _syncing = false;

// chatStore → leaf stores (supports tests doing useChatStore.setState({ ... }))
useChatStore.subscribe((state) => {
  if (_syncing) return;
  _syncing = true;
  useBootstrapStore.setState({
    isBootstrapping: state.isBootstrapping,
    bootstrapFolderName: state.bootstrapFolderName,
    bootstrapApiHistory: state.bootstrapApiHistory,
    bootstrapFilesWritten: state.bootstrapFilesWritten,
  });
  useToolRunStore.setState({
    toolRunState: state.toolRunState,
    pendingToolCalls: state.pendingToolCalls,
    toolIterationCount: state.toolIterationCount,
  });
  useSummaryStore.setState({
    currentSummary: state.currentSummary,
    summaryUpToMessageId: state.summaryUpToMessageId,
    summaryJobId: state.summaryJobId,
  });
  _syncing = false;
});

// leaf stores → chatStore (e.g., when summaryStore's async job completes)
function syncLeafToChat() {
  if (_syncing) return;
  _syncing = true;
  const bs = useBootstrapStore.getState();
  const ts = useToolRunStore.getState();
  const ss = useSummaryStore.getState();
  useChatStore.setState({
    isBootstrapping: bs.isBootstrapping,
    bootstrapFolderName: bs.bootstrapFolderName,
    bootstrapApiHistory: bs.bootstrapApiHistory,
    bootstrapFilesWritten: bs.bootstrapFilesWritten,
    toolRunState: ts.toolRunState,
    pendingToolCalls: ts.pendingToolCalls,
    toolIterationCount: ts.toolIterationCount,
    currentSummary: ss.currentSummary,
    summaryUpToMessageId: ss.summaryUpToMessageId,
    summaryJobId: ss.summaryJobId,
  });
  _syncing = false;
}

useBootstrapStore.subscribe(syncLeafToChat);
useToolRunStore.subscribe(syncLeafToChat);
useSummaryStore.subscribe(syncLeafToChat);
