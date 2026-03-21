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

export async function relayStart(): Promise<void> {
  return invoke("relay_start");
}

export async function relayStop(): Promise<void> {
  return invoke("relay_stop");
}

export async function relayStatus(): Promise<string> {
  return invoke("relay_status");
}

export async function relayGetPeerId(): Promise<string> {
  return invoke("relay_get_peer_id");
}

// ── Invites ──

export async function relayGenerateInvite(
  agentName: string,
  agentDescription: string,
  addresses: string[] = [],
  expiryHours?: number,
): Promise<string> {
  return invoke("relay_generate_invite", {
    agentName,
    agentDescription,
    addresses,
    expiryHours: expiryHours ?? null,
  });
}

export async function relayAcceptInvite(
  code: string,
  localAgentId?: string,
): Promise<ContactRow> {
  return invoke("relay_accept_invite", {
    code,
    localAgentId: localAgentId ?? null,
  });
}

// ── Contacts ──

export async function relayListContacts(): Promise<ContactRow[]> {
  return invoke("relay_list_contacts");
}

export async function relayUpdateContact(
  id: string,
  displayName?: string,
  localAgentId?: string,
  mode?: string,
): Promise<void> {
  return invoke("relay_update_contact", {
    id,
    displayName: displayName ?? null,
    localAgentId: localAgentId ?? null,
    mode: mode ?? null,
  });
}

export async function relayRemoveContact(id: string): Promise<void> {
  return invoke("relay_remove_contact", { id });
}

export async function relayApproveContact(contactId: string): Promise<void> {
  return invoke("relay_approve_contact", { contactId });
}

export async function relayRejectContact(contactId: string): Promise<void> {
  return invoke("relay_reject_contact", { contactId });
}

// ── Messaging ──

export async function relaySendMessage(
  contactId: string,
  content: string,
): Promise<void> {
  return invoke("relay_send_message", { contactId, content });
}

export async function relayApproveMessage(
  messageId: string,
  responseContent: string,
): Promise<string> {
  return invoke("relay_approve_message", { messageId, responseContent });
}

export async function relayRejectMessage(messageId: string): Promise<void> {
  return invoke("relay_reject_message", { messageId });
}

export async function relayRequestDraft(
  messageId: string,
  agentId: string,
): Promise<string> {
  return invoke("relay_request_draft", { messageId, agentId });
}

// ── Network Enabled ──

export async function relayGetNetworkEnabled(): Promise<boolean> {
  return invoke("relay_get_network_enabled");
}

export async function relaySetNetworkEnabled(enabled: boolean): Promise<void> {
  return invoke("relay_set_network_enabled", { enabled });
}

// ── Relay URL ──

export async function relayGetRelayUrl(): Promise<string> {
  return invoke("relay_get_relay_url");
}

export async function relaySetRelayUrl(url: string): Promise<void> {
  return invoke("relay_set_relay_url", { url });
}

// ── Threads ──

export async function relayListThreads(
  contactId: string,
): Promise<PeerThreadRow[]> {
  return invoke("relay_list_threads", { contactId });
}

export async function relayGetThreadMessages(
  threadId: string,
): Promise<PeerMessageRow[]> {
  return invoke("relay_get_thread_messages", { threadId });
}
