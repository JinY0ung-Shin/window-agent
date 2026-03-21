import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  relayStart,
  relayStop,
  relayStatus,
  relayGetPeerId,
  relayListContacts,
  relayGenerateInvite,
  relayAcceptInvite,
  relayListThreads,
  relayGetThreadMessages,
  relayApproveMessage,
  relayRejectMessage,
  relaySendMessage,
  relayGetNetworkEnabled,
  relaySetNetworkEnabled,
  relayApproveContact,
  relayRejectContact,
  type ContactRow,
  type PeerThreadRow,
  type PeerMessageRow,
} from "../services/commands/relayCommands";
import { i18n } from "../i18n";

type NetworkStatus = "dormant" | "starting" | "active" | "stopping" | "reconnecting";

import { logger } from "../services/logger";

// Event payload types emitted by the Rust backend
interface ConnectionStatePayload {
  status: string;
  peer_count: number;
}

interface PresencePayload {
  peer_id: string;
  status: "online" | "offline";
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
  approveContact: (contactId: string) => Promise<void>;
  rejectContact: (contactId: string) => Promise<void>;
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
      enabled = await relayGetNetworkEnabled();
    } catch (e) {
      logger.debug("Network enabled check failed, using localStorage", e);
      enabled = localStorage.getItem(STORAGE_KEY) === "true";
    }
    set({ networkEnabled: enabled });
    if (enabled) {
      try {
        await get().startNetwork();
      } catch (e) {
        logger.debug("Network start deferred, staying dormant", e);
      }
    }
  },

  startNetwork: async () => {
    set({ status: "starting", error: null });
    try {
      await relayStart();
      const [statusStr, peerId, contacts] = await Promise.all([
        relayStatus(),
        relayGetPeerId(),
        relayListContacts(),
      ]);
      try {
        await relaySetNetworkEnabled(true);
      } catch (e) {
        logger.debug("Persist network enabled failed, using localStorage", e);
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
      await relayStop();
      try {
        await relaySetNetworkEnabled(false);
      } catch (e) {
        logger.debug("Persist network disabled failed, using localStorage", e);
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
        approvalSummaries: {},
        connectedPeers: new Set<string>(),
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshStatus: async () => {
    try {
      const statusStr = await relayStatus();
      set({ status: statusStr as NetworkStatus });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshContacts: async () => {
    try {
      const contacts = await relayListContacts();
      set({ contacts });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  generateInvite: async (agentName, agentDesc, expiryHours) => {
    return relayGenerateInvite(agentName, agentDesc, [], expiryHours);
  },

  acceptInvite: async (code, localAgentId) => {
    await relayAcceptInvite(code, localAgentId);
    await get().refreshContacts();
  },

  selectContact: (contactId) => {
    set({ selectedContactId: contactId, selectedThreadId: null, threads: [], messages: [] });
    if (contactId) {
      get().loadThreads(contactId).then(() => {
        // 비동기 완료 전에 다른 contact가 선택됐으면 스킵
        if (get().selectedContactId !== contactId) return;
        const threads = get().threads;
        if (threads.length > 0) {
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
      const threads = await relayListThreads(contactId);
      // Guard against stale results if contact changed during async call
      if (get().selectedContactId !== contactId) return;
      set({ threads });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadMessages: async (threadId) => {
    try {
      const messages = await relayGetThreadMessages(threadId);
      set({ messages });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  sendMessage: async (contactId, content) => {
    await relaySendMessage(contactId, content);
    const { selectedContactId } = get();
    if (selectedContactId === contactId) {
      // Reload threads (a new thread may have been created)
      await get().loadThreads(contactId);
      const { threads, selectedThreadId } = get();
      if (!selectedThreadId && threads.length > 0) {
        // Auto-select the new thread
        await get().selectThread(threads[0].id);
      } else if (selectedThreadId) {
        await get().loadMessages(selectedThreadId);
      }
    }
  },

  approveMessage: async (messageId, responseContent = i18n.t("network:approval.defaultResponse")) => {
    await relayApproveMessage(messageId, responseContent);
    const { selectedThreadId } = get();
    if (selectedThreadId) {
      await get().loadMessages(selectedThreadId);
    }
    set((s) => {
      const { [messageId]: _, ...rest } = s.approvalSummaries;
      return {
        approvalSummaries: rest,
        pendingApprovals: Math.max(0, s.pendingApprovals - 1),
      };
    });
  },

  rejectMessage: async (messageId) => {
    await relayRejectMessage(messageId);
    const { selectedThreadId } = get();
    if (selectedThreadId) {
      await get().loadMessages(selectedThreadId);
    }
    set((s) => {
      const { [messageId]: _, ...rest } = s.approvalSummaries;
      return {
        approvalSummaries: rest,
        pendingApprovals: Math.max(0, s.pendingApprovals - 1),
      };
    });
  },

  approveContact: async (contactId) => {
    await relayApproveContact(contactId);
    await get().refreshContacts();
    set((s) => ({ pendingApprovals: Math.max(0, s.pendingApprovals - 1) }));
  },

  rejectContact: async (contactId) => {
    await relayRejectContact(contactId);
    await get().refreshContacts();
    set((s) => ({ pendingApprovals: Math.max(0, s.pendingApprovals - 1) }));
  },

  setupEventListeners: async () => {
    const unlisteners: UnlistenFn[] = [];

    unlisteners.push(
      await listen<ConnectionStatePayload>("relay:connection-state", (event) => {
        const payload = event.payload;
        set({ status: payload.status as NetworkStatus });
      }),
    );

    unlisteners.push(
      await listen<PresencePayload>("relay:presence", (event) => {
        const { peer_id, status } = event.payload;
        set((s) => {
          const next = new Set(s.connectedPeers);
          if (status === "online") {
            next.add(peer_id);
          } else {
            next.delete(peer_id);
          }
          return { connectedPeers: next };
        });
        get().refreshContacts();
      }),
    );

    unlisteners.push(
      await listen("relay:incoming-message", () => {
        const { selectedThreadId } = get();
        if (selectedThreadId) {
          get().loadMessages(selectedThreadId);
        }
      }),
    );

    unlisteners.push(
      await listen<ApprovalNeededPayload & { type?: string }>("relay:approval-needed", (event) => {
        const payload = event.payload;
        if (payload.type === "introduce") {
          // Contact introduction — refresh contacts list to show pending_approval contact
          set((s) => ({ pendingApprovals: s.pendingApprovals + 1 }));
          get().refreshContacts();
          return;
        }
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
      await listen("relay:delivery-update", () => {
        const { selectedThreadId } = get();
        if (selectedThreadId) {
          get().loadMessages(selectedThreadId);
        }
      }),
    );

    unlisteners.push(
      await listen<ErrorPayload>("relay:error", (event) => {
        const payload = event.payload;
        set({ error: payload.message });
      }),
    );

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  },
}));
