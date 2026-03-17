import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  p2pStart,
  p2pStop,
  p2pStatus,
  p2pGetPeerId,
  p2pListContacts,
  p2pGenerateInvite,
  p2pAcceptInvite,
  p2pListThreads,
  p2pGetThreadMessages,
  p2pApproveMessage,
  p2pRejectMessage,
  p2pSendMessage,
  p2pGetNetworkEnabled,
  p2pSetNetworkEnabled,
  type ContactRow,
  type PeerThreadRow,
  type PeerMessageRow,
} from "../services/commands/p2pCommands";

type NetworkStatus = "dormant" | "starting" | "active" | "stopping";

// Event payload types emitted by the Rust backend
interface ConnectionStatePayload {
  status: string;
  peer_count: number;
}

interface PeerEventPayload {
  peer_id: string;
  contact_name: string;
}

interface ErrorPayload {
  code: string;
  message: string;
}

interface ApprovalNeededPayload {
  thread_id: string;
  message_id: string;
  sender_agent: string;
  summary: string;
  original_content: string;
}

const STORAGE_KEY = "network_enabled";

interface NetworkState {
  // ── State ──
  status: NetworkStatus;
  peerId: string | null;
  networkEnabled: boolean;
  contacts: ContactRow[];
  selectedContactId: string | null;
  selectedThreadId: string | null;
  threads: PeerThreadRow[];
  messages: PeerMessageRow[];
  pendingApprovals: number;
  approvalSummaries: Record<string, string>; // messageId -> summary
  connectedPeers: Set<string>; // live connected peer_ids
  error: string | null;

  // ── Actions ──
  initialize: () => Promise<void>;
  startNetwork: () => Promise<void>;
  stopNetwork: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshContacts: () => Promise<void>;
  generateInvite: (agentName: string, agentDesc: string, expiryHours?: number) => Promise<string>;
  acceptInvite: (code: string, localAgentId?: string) => Promise<void>;
  selectContact: (contactId: string | null) => void;
  selectThread: (threadId: string | null) => Promise<void>;
  loadThreads: (contactId: string) => Promise<void>;
  loadMessages: (threadId: string) => Promise<void>;
  sendMessage: (contactId: string, content: string) => Promise<void>;
  approveMessage: (messageId: string, responseContent?: string) => Promise<void>;
  rejectMessage: (messageId: string) => Promise<void>;
  setupEventListeners: () => Promise<() => void>;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  status: "dormant",
  peerId: null,
  networkEnabled: localStorage.getItem(STORAGE_KEY) === "true",
  contacts: [],
  selectedContactId: null,
  selectedThreadId: null,
  threads: [],
  messages: [],
  pendingApprovals: 0,
  approvalSummaries: {},
  connectedPeers: new Set<string>(),
  error: null,

  initialize: async () => {
    let enabled: boolean;
    try {
      enabled = await p2pGetNetworkEnabled();
    } catch {
      // Tauri not available (e.g. tests) — fall back to localStorage
      enabled = localStorage.getItem(STORAGE_KEY) === "true";
    }
    set({ networkEnabled: enabled });
    if (enabled) {
      try {
        await get().startNetwork();
      } catch {
        // Network may not be available yet; stay dormant
      }
    }
  },

  startNetwork: async () => {
    set({ status: "starting", error: null });
    try {
      await p2pStart();
      const [statusStr, peerId, contacts] = await Promise.all([
        p2pStatus(),
        p2pGetPeerId(),
        p2pListContacts(),
      ]);
      try {
        await p2pSetNetworkEnabled(true);
      } catch {
        localStorage.setItem(STORAGE_KEY, "true");
      }
      set({
        status: statusStr as NetworkStatus,
        peerId,
        contacts,
        networkEnabled: true,
      });
    } catch (e) {
      set({ status: "dormant", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  stopNetwork: async () => {
    set({ status: "stopping", error: null });
    try {
      await p2pStop();
      try {
        await p2pSetNetworkEnabled(false);
      } catch {
        localStorage.setItem(STORAGE_KEY, "false");
      }
      set({
        status: "dormant",
        peerId: null,
        contacts: [],
        networkEnabled: false,
        threads: [],
        messages: [],
        selectedContactId: null,
        selectedThreadId: null,
        pendingApprovals: 0,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshStatus: async () => {
    try {
      const statusStr = await p2pStatus();
      set({ status: statusStr as NetworkStatus });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshContacts: async () => {
    try {
      const contacts = await p2pListContacts();
      set({ contacts });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  generateInvite: async (agentName, agentDesc, expiryHours) => {
    return p2pGenerateInvite(agentName, agentDesc, expiryHours);
  },

  acceptInvite: async (code, localAgentId) => {
    await p2pAcceptInvite(code, localAgentId);
    await get().refreshContacts();
  },

  selectContact: (contactId) => {
    set({ selectedContactId: contactId, selectedThreadId: null, threads: [], messages: [] });
    if (contactId) {
      get().loadThreads(contactId).then(() => {
        const threads = get().threads;
        if (threads.length > 0) {
          // Auto-select the most recent thread
          const latest = threads.reduce((a, b) =>
            a.updated_at > b.updated_at ? a : b
          );
          get().selectThread(latest.id);
        }
      });
    }
  },

  selectThread: async (threadId) => {
    set({ selectedThreadId: threadId, messages: [] });
    if (threadId) {
      await get().loadMessages(threadId);
    }
  },

  loadThreads: async (contactId) => {
    try {
      const threads = await p2pListThreads(contactId);
      set({ threads });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadMessages: async (threadId) => {
    try {
      const messages = await p2pGetThreadMessages(threadId);
      set({ messages });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  sendMessage: async (contactId, content) => {
    await p2pSendMessage(contactId, content);
    // Refresh threads/messages for active thread
    const { selectedThreadId, selectedContactId } = get();
    if (selectedContactId === contactId && selectedThreadId) {
      await get().loadMessages(selectedThreadId);
    }
  },

  approveMessage: async (messageId, responseContent = "감사합니다. 확인했습니다.") => {
    await p2pApproveMessage(messageId, responseContent);
    const { selectedThreadId, pendingApprovals } = get();
    if (selectedThreadId) {
      await get().loadMessages(selectedThreadId);
    }
    set({ pendingApprovals: Math.max(0, pendingApprovals - 1) });
  },

  rejectMessage: async (messageId) => {
    await p2pRejectMessage(messageId);
    const { selectedThreadId, pendingApprovals } = get();
    if (selectedThreadId) {
      await get().loadMessages(selectedThreadId);
    }
    set({ pendingApprovals: Math.max(0, pendingApprovals - 1) });
  },

  setupEventListeners: async () => {
    const unlisteners: UnlistenFn[] = [];

    unlisteners.push(
      await listen<ConnectionStatePayload>("p2p:connection-state", (event) => {
        const payload = event.payload;
        set({ status: payload.status as NetworkStatus });
      }),
    );

    unlisteners.push(
      await listen<PeerEventPayload>("p2p:peer-connected", (event) => {
        const { peer_id } = event.payload;
        set((s) => ({ connectedPeers: new Set([...s.connectedPeers, peer_id]) }));
        get().refreshContacts();
      }),
    );

    unlisteners.push(
      await listen<PeerEventPayload>("p2p:peer-disconnected", (event) => {
        const { peer_id } = event.payload;
        set((s) => {
          const next = new Set(s.connectedPeers);
          next.delete(peer_id);
          return { connectedPeers: next };
        });
        get().refreshContacts();
      }),
    );

    unlisteners.push(
      await listen("p2p:incoming-message", () => {
        const { selectedThreadId } = get();
        if (selectedThreadId) {
          get().loadMessages(selectedThreadId);
        }
      }),
    );

    unlisteners.push(
      await listen<ApprovalNeededPayload>("p2p:approval-needed", (event) => {
        const payload = event.payload;
        set((s) => ({
          pendingApprovals: s.pendingApprovals + 1,
          approvalSummaries: { ...s.approvalSummaries, [payload.message_id]: payload.summary },
        }));
        // Also refresh messages if viewing the relevant thread
        const { selectedThreadId } = get();
        if (selectedThreadId) {
          get().loadMessages(selectedThreadId);
        }
      }),
    );

    unlisteners.push(
      await listen("p2p:delivery-update", () => {
        const { selectedThreadId } = get();
        if (selectedThreadId) {
          get().loadMessages(selectedThreadId);
        }
      }),
    );

    unlisteners.push(
      await listen<ErrorPayload>("p2p:error", (event) => {
        const payload = event.payload;
        set({ error: payload.message });
      }),
    );

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  },
}));
