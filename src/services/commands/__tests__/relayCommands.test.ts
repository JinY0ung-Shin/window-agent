import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  relayStart,
  relayStop,
  relayStatus,
  relayGetPeerId,
  relayGenerateInvite,
  relayAcceptInvite,
  relayListContacts,
  relayUpdateContact,
  relayRemoveContact,
  relayApproveContact,
  relayRejectContact,
  relaySendMessage,
  relayGetNetworkEnabled,
  relaySetNetworkEnabled,
  relayGetAllowedTools,
  relaySetAllowedTools,
  relayGetRelayUrl,
  relaySetRelayUrl,
  relayListThreads,
  relayGetThreadMessages,
} from "../relayCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("relayCommands", () => {
  // ── Lifecycle ──

  it("relayStart calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relayStart();
    expect(invoke).toHaveBeenCalledWith("relay_start");
  });

  it("relayStop calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relayStop();
    expect(invoke).toHaveBeenCalledWith("relay_stop");
  });

  it("relayStatus calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue("running");
    const result = await relayStatus();
    expect(invoke).toHaveBeenCalledWith("relay_status");
    expect(result).toBe("running");
  });

  it("relayGetPeerId calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue("peer-123");
    const result = await relayGetPeerId();
    expect(invoke).toHaveBeenCalledWith("relay_get_peer_id");
    expect(result).toBe("peer-123");
  });

  // ── Invites ──

  it("relayGenerateInvite passes all args with defaults", async () => {
    vi.mocked(invoke).mockResolvedValue("invite-code");
    const result = await relayGenerateInvite("Agent A", "Desc");
    expect(invoke).toHaveBeenCalledWith("relay_generate_invite", {
      agentName: "Agent A",
      agentDescription: "Desc",
      addresses: [],
      expiryHours: null,
    });
    expect(result).toBe("invite-code");
  });

  it("relayGenerateInvite passes custom addresses and expiryHours", async () => {
    vi.mocked(invoke).mockResolvedValue("invite-code-2");
    await relayGenerateInvite("Agent B", "Desc B", ["/ip4/1.2.3.4"], 24);
    expect(invoke).toHaveBeenCalledWith("relay_generate_invite", {
      agentName: "Agent B",
      agentDescription: "Desc B",
      addresses: ["/ip4/1.2.3.4"],
      expiryHours: 24,
    });
  });

  it("relayAcceptInvite passes code with null localAgentId by default", async () => {
    const contact = { id: "ct1", peer_id: "p1" };
    vi.mocked(invoke).mockResolvedValue(contact);
    const result = await relayAcceptInvite("some-code");
    expect(invoke).toHaveBeenCalledWith("relay_accept_invite", {
      code: "some-code",
      localAgentId: null,
    });
    expect(result).toEqual(contact);
  });

  it("relayAcceptInvite passes localAgentId when provided", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "ct2" });
    await relayAcceptInvite("code", "a1");
    expect(invoke).toHaveBeenCalledWith("relay_accept_invite", {
      code: "code",
      localAgentId: "a1",
    });
  });

  // ── Contacts ──

  it("relayListContacts calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await relayListContacts();
    expect(invoke).toHaveBeenCalledWith("relay_list_contacts");
  });

  it("relayUpdateContact passes all args with null defaults", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relayUpdateContact("ct1");
    expect(invoke).toHaveBeenCalledWith("relay_update_contact", {
      id: "ct1",
      displayName: null,
      localAgentId: null,
      mode: null,
    });
  });

  it("relayUpdateContact passes provided optional args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relayUpdateContact("ct1", "New Name", "a2", "auto");
    expect(invoke).toHaveBeenCalledWith("relay_update_contact", {
      id: "ct1",
      displayName: "New Name",
      localAgentId: "a2",
      mode: "auto",
    });
  });

  it("relayRemoveContact passes id", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relayRemoveContact("ct1");
    expect(invoke).toHaveBeenCalledWith("relay_remove_contact", { id: "ct1" });
  });

  it("relayApproveContact passes contactId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relayApproveContact("ct1");
    expect(invoke).toHaveBeenCalledWith("relay_approve_contact", { contactId: "ct1" });
  });

  it("relayRejectContact passes contactId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relayRejectContact("ct1");
    expect(invoke).toHaveBeenCalledWith("relay_reject_contact", { contactId: "ct1" });
  });

  // ── Messaging ──

  it("relaySendMessage passes contactId and content", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relaySendMessage("ct1", "Hello!");
    expect(invoke).toHaveBeenCalledWith("relay_send_message", {
      contactId: "ct1",
      content: "Hello!",
    });
  });

  // ── Network Enabled ──

  it("relayGetNetworkEnabled calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    const result = await relayGetNetworkEnabled();
    expect(invoke).toHaveBeenCalledWith("relay_get_network_enabled");
    expect(result).toBe(true);
  });

  it("relaySetNetworkEnabled passes enabled flag", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relaySetNetworkEnabled(false);
    expect(invoke).toHaveBeenCalledWith("relay_set_network_enabled", { enabled: false });
  });

  // ── Relay Allowed Tools ──

  it("relayGetAllowedTools calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue(["read_file", "search"]);
    const result = await relayGetAllowedTools();
    expect(invoke).toHaveBeenCalledWith("relay_get_allowed_tools");
    expect(result).toEqual(["read_file", "search"]);
  });

  it("relaySetAllowedTools passes tools array", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relaySetAllowedTools(["read_file"]);
    expect(invoke).toHaveBeenCalledWith("relay_set_allowed_tools", { tools: ["read_file"] });
  });

  // ── Relay URL ──

  it("relayGetRelayUrl calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue("wss://relay.example.com");
    const result = await relayGetRelayUrl();
    expect(invoke).toHaveBeenCalledWith("relay_get_relay_url");
    expect(result).toBe("wss://relay.example.com");
  });

  it("relaySetRelayUrl passes url", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relaySetRelayUrl("wss://new-relay.example.com");
    expect(invoke).toHaveBeenCalledWith("relay_set_relay_url", { url: "wss://new-relay.example.com" });
  });

  // ── Threads ──

  it("relayListThreads passes contactId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await relayListThreads("ct1");
    expect(invoke).toHaveBeenCalledWith("relay_list_threads", { contactId: "ct1" });
  });

  it("relayGetThreadMessages passes threadId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await relayGetThreadMessages("th1");
    expect(invoke).toHaveBeenCalledWith("relay_get_thread_messages", { threadId: "th1" });
  });
});
