import { invoke } from "@tauri-apps/api/core";

// ── Types ──

export interface ContactRow {
  id: string;
  peer_id: string;
  public_key: string;
  display_name: string;
  agent_name: string;
  agent_description: string;
  local_agent_id: string | null;
  mode: string;
  capabilities_json: string;
  status: string;
  invite_card_raw: string | null;
  addresses_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeerThreadRow {
  id: string;
  contact_id: string;
  local_agent_id: string | null;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeerMessageRow {
  id: string;
  thread_id: string;
  message_id_unique: string;
  correlation_id: string | null;
  direction: string;
  sender_agent: string;
  content: string;
  approval_state: string;
  delivery_state: string;
  retry_count: number;
  raw_envelope: string | null;
  created_at: string;
}

// ── Lifecycle ──

export async function p2pStart(): Promise<void> {
  return invoke("p2p_start");
}

export async function p2pStop(): Promise<void> {
  return invoke("p2p_stop");
}

export async function p2pStatus(): Promise<string> {
  return invoke("p2p_status");
}

export async function p2pGetPeerId(): Promise<string> {
  return invoke("p2p_get_peer_id");
}

// ── Invites ──

export async function p2pGenerateInvite(
  agentName: string,
  agentDescription: string,
  addresses: string[] = [],
  expiryHours?: number,
): Promise<string> {
  return invoke("p2p_generate_invite", {
    agentName,
    agentDescription,
    addresses,
    expiryHours: expiryHours ?? null,
  });
}

export async function p2pAcceptInvite(
  code: string,
  localAgentId?: string,
): Promise<ContactRow> {
  return invoke("p2p_accept_invite", {
    code,
    localAgentId: localAgentId ?? null,
  });
}

// ── Contacts ──

export async function p2pListContacts(): Promise<ContactRow[]> {
  return invoke("p2p_list_contacts");
}

export async function p2pUpdateContact(
  id: string,
  displayName?: string,
  localAgentId?: string,
  mode?: string,
): Promise<void> {
  return invoke("p2p_update_contact", {
    id,
    displayName: displayName ?? null,
    localAgentId: localAgentId ?? null,
    mode: mode ?? null,
  });
}

export async function p2pRemoveContact(id: string): Promise<void> {
  return invoke("p2p_remove_contact", { id });
}

export async function p2pBindAgent(
  contactId: string,
  agentId: string,
): Promise<void> {
  return invoke("p2p_bind_agent", { contactId, agentId });
}

// ── Messaging ──

export async function p2pSendMessage(
  contactId: string,
  content: string,
): Promise<void> {
  return invoke("p2p_send_message", { contactId, content });
}

export async function p2pApproveMessage(
  messageId: string,
  responseContent: string,
): Promise<string> {
  return invoke("p2p_approve_message", { messageId, responseContent });
}

export async function p2pRejectMessage(messageId: string): Promise<void> {
  return invoke("p2p_reject_message", { messageId });
}

export async function p2pRequestDraft(
  messageId: string,
  agentId: string,
): Promise<string> {
  return invoke("p2p_request_draft", { messageId, agentId });
}

// ── Connection Info ──

export interface ConnectionInfo {
  peer_id: string;
  configured_listen_port: number | null;
  active_listen_port: number | null;
  listen_addresses: string[];
  status: string;
}

export async function p2pGetConnectionInfo(): Promise<ConnectionInfo> {
  return invoke("p2p_get_connection_info");
}

// ── Network Enabled ──

export async function p2pGetNetworkEnabled(): Promise<boolean> {
  return invoke("p2p_get_network_enabled");
}

export async function p2pSetNetworkEnabled(enabled: boolean): Promise<void> {
  return invoke("p2p_set_network_enabled", { enabled });
}

// ── Listen Port ──

export async function p2pGetListenPort(): Promise<number | null> {
  return invoke("p2p_get_listen_port");
}

export async function p2pSetListenPort(port: number | null): Promise<void> {
  return invoke("p2p_set_listen_port", { port });
}

// ── Dial ──

export async function p2pDialPeer(contactId: string): Promise<void> {
  return invoke("p2p_dial_peer", { contactId });
}

// ── Threads ──

export async function p2pListThreads(
  contactId: string,
): Promise<PeerThreadRow[]> {
  return invoke("p2p_list_threads", { contactId });
}

export async function p2pGetThread(
  threadId: string,
): Promise<PeerThreadRow | null> {
  return invoke("p2p_get_thread", { threadId });
}

export async function p2pGetThreadMessages(
  threadId: string,
): Promise<PeerMessageRow[]> {
  return invoke("p2p_get_thread_messages", { threadId });
}

