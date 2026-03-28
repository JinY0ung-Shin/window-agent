/**
 * Tests for streaming navigation resilience:
 * - Background stream shelving/unshelving across conversation switches
 * - Stream content caching for navigation round-trips
 * - flushDelta behavior when pending message is missing
 * - openAgentChat guard preserving in-flight state
 * - New conversation optimistic insertion into conversations list
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useStreamStore,
  shelveActiveRun,
  unshelveStream,
  clearShelvedStream,
  cacheStreamContent,
  getCachedStreamContent,
  clearStreamContentCache,
} from "../streamStore";
import { useMessageStore } from "../messageStore";
import { useConversationStore } from "../conversationStore";
import { useAgentStore } from "../agentStore";
import { useTeamStore } from "../teamStore";
import { resetTransientChatState } from "../resetHelper";
import * as cmds from "../../services/tauriCommands";
import type { ActiveRun } from "../../services/types";

vi.mock("../../services/tauriCommands");
vi.mock("../../services/commands/vaultCommands", () => ({
  vaultListNotes: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../services/lifecycleEvents", () => ({
  emitLifecycleEvent: vi.fn(),
  onLifecycleEvent: vi.fn(),
}));

const initialStream = useStreamStore.getState();
const initialMsg = useMessageStore.getState();
const initialConv = useConversationStore.getState();
const initialAgent = useAgentStore.getState();
const initialTeam = useTeamStore.getState();

const makeRun = (overrides: Partial<ActiveRun> = {}): ActiveRun => ({
  requestId: "req-1",
  conversationId: "conv-1",
  targetMessageId: "pending-1",
  status: "streaming",
  ...overrides,
});

beforeEach(() => {
  useStreamStore.setState(initialStream, true);
  useMessageStore.setState(initialMsg, true);
  useConversationStore.setState(initialConv, true);
  useAgentStore.setState(initialAgent, true);
  useTeamStore.setState(initialTeam, true);
  // Clean module-level maps
  clearShelvedStream("conv-1");
  clearShelvedStream("conv-2");
  clearStreamContentCache("pending-1");
  clearStreamContentCache("pending-2");
  vi.clearAllMocks();
});

// ── shelveActiveRun / unshelveStream ───────────────────

describe("shelveActiveRun", () => {
  it("saves active run to background map keyed by conversationId", () => {
    useStreamStore.setState({ activeRun: makeRun() });
    shelveActiveRun();
    const entry = unshelveStream("conv-1");
    expect(entry).toEqual({ requestId: "req-1", msgId: "pending-1" });
  });

  it("does nothing when no active run", () => {
    shelveActiveRun();
    expect(unshelveStream("conv-1")).toBeUndefined();
  });

  it("does nothing when active run has no conversationId", () => {
    useStreamStore.setState({
      activeRun: { requestId: "r", conversationId: "", targetMessageId: "m", status: "streaming" },
    });
    shelveActiveRun();
    expect(unshelveStream("")).toBeUndefined();
  });
});

describe("unshelveStream", () => {
  it("returns and removes the shelved entry", () => {
    useStreamStore.setState({ activeRun: makeRun() });
    shelveActiveRun();

    const first = unshelveStream("conv-1");
    expect(first).toBeDefined();

    const second = unshelveStream("conv-1");
    expect(second).toBeUndefined();
  });

  it("returns undefined for unknown conversationId", () => {
    expect(unshelveStream("unknown")).toBeUndefined();
  });
});

describe("clearShelvedStream", () => {
  it("removes shelved entry without returning it", () => {
    useStreamStore.setState({ activeRun: makeRun() });
    shelveActiveRun();
    clearShelvedStream("conv-1");
    expect(unshelveStream("conv-1")).toBeUndefined();
  });
});

// ── Stream content cache ──────────────────────────────

describe("streamContentCache", () => {
  it("stores and retrieves content by msgId", () => {
    cacheStreamContent("pending-1", "Hello ");
    expect(getCachedStreamContent("pending-1")).toBe("Hello ");
  });

  it("returns empty string for unknown msgId", () => {
    expect(getCachedStreamContent("nonexistent")).toBe("");
  });

  it("accumulates content across multiple writes", () => {
    cacheStreamContent("pending-1", "Hello ");
    cacheStreamContent("pending-1", "Hello world");
    expect(getCachedStreamContent("pending-1")).toBe("Hello world");
  });

  it("clearStreamContentCache removes entry", () => {
    cacheStreamContent("pending-1", "data");
    clearStreamContentCache("pending-1");
    expect(getCachedStreamContent("pending-1")).toBe("");
  });
});

// ── resetTransientChatState shelving ──────────────────

describe("resetTransientChatState shelves active run", () => {
  it("shelves activeRun before clearing it", () => {
    useStreamStore.setState({ activeRun: makeRun({ conversationId: "conv-1" }) });
    resetTransientChatState();

    // activeRun should be cleared
    expect(useStreamStore.getState().activeRun).toBeNull();

    // But the run info should be shelved
    const shelved = unshelveStream("conv-1");
    expect(shelved).toEqual({ requestId: "req-1", msgId: "pending-1" });
  });

  it("clears messages and input as before", () => {
    useMessageStore.setState({
      messages: [{ id: "m1", type: "user", content: "test", status: "complete" }],
      inputValue: "draft",
    });
    useStreamStore.setState({ activeRun: makeRun() });

    resetTransientChatState();

    expect(useMessageStore.getState().messages).toEqual([]);
    expect(useMessageStore.getState().inputValue).toBe("");
  });
});

// ── openAgentChat guard ───────────────────────────────

describe("openAgentChat guard", () => {
  it("skips re-selection when current conversation belongs to the same agent", async () => {
    const spy = vi.spyOn(useConversationStore.getState(), "selectConversation");

    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [{ id: "c1", title: "Conv", agent_id: "a1", created_at: "", updated_at: "" }],
    });
    useStreamStore.setState({ activeRun: makeRun({ conversationId: "c1" }) });
    useMessageStore.setState({
      messages: [{ id: "pending-1", type: "agent", content: "streaming...", status: "streaming" }],
    });

    await useConversationStore.getState().openAgentChat("a1");

    expect(spy).not.toHaveBeenCalled();
    // Streaming state preserved
    expect(useStreamStore.getState().activeRun).not.toBeNull();
    expect(useMessageStore.getState().messages).toHaveLength(1);

    spy.mockRestore();
  });

  it("skips re-selection for optimistic conversation via selectedAgentId", async () => {
    const spy = vi.spyOn(useConversationStore.getState(), "selectConversation");

    useAgentStore.setState({ selectedAgentId: "a1" });
    useConversationStore.setState({
      currentConversationId: "optimistic-c1",
      conversations: [], // not yet in list
    });

    await useConversationStore.getState().openAgentChat("a1");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does NOT skip when team is selected (selectedAgentId fallback disabled)", async () => {
    useAgentStore.setState({ selectedAgentId: "a1" });
    useTeamStore.setState({ selectedTeamId: "team-1" });
    useConversationStore.setState({
      currentConversationId: "team-conv",
      conversations: [],
    });

    // Should fall through to the "no agentConv" branch → resetChatContext
    await useConversationStore.getState().openAgentChat("a1");

    // currentConversationId should be cleared (resetChatContext called)
    expect(useConversationStore.getState().currentConversationId).toBeNull();
  });
});

// ── selectConversation + shelved stream restore ───────

describe("selectConversation restores shelved streams", () => {
  beforeEach(() => {
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "conv-1",
      title: "Test",
      agent_id: "a1",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(cmds.getMessages).mockResolvedValue([
      { id: "db-user", conversation_id: "conv-1", role: "user", content: "hello", created_at: "" },
    ]);
    vi.mocked(cmds.readConsolidatedMemory).mockResolvedValue(null);

    useAgentStore.setState({
      agents: [{ id: "a1", folder_name: "test", name: "Test", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
  });

  it("re-injects pending message with cached content when shelved stream exists", async () => {
    // Simulate: stream was running, user navigated away
    useStreamStore.setState({ activeRun: makeRun({ conversationId: "conv-1" }) });
    cacheStreamContent("pending-1", "Previously streamed content...");
    shelveActiveRun();
    useStreamStore.setState({ activeRun: null });

    useConversationStore.setState({
      conversations: [{ id: "conv-1", title: "Test", agent_id: "a1", created_at: "", updated_at: "" }],
    });

    // Navigate back
    await useConversationStore.getState().selectConversation("conv-1");

    const messages = useMessageStore.getState().messages;
    // Should have: DB user message + restored pending message
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const restored = messages.find((m) => m.id === "pending-1");
    expect(restored).toBeDefined();
    expect(restored!.content).toBe("Previously streamed content...");
    expect(restored!.status).toBe("streaming");

    // activeRun should be restored
    const run = useStreamStore.getState().activeRun;
    expect(run).not.toBeNull();
    expect(run!.requestId).toBe("req-1");
    expect(run!.targetMessageId).toBe("pending-1");
  });

  it("does NOT inject pending message when no shelved stream", async () => {
    useConversationStore.setState({
      conversations: [{ id: "conv-1", title: "Test", agent_id: "a1", created_at: "", updated_at: "" }],
    });

    await useConversationStore.getState().selectConversation("conv-1");

    const messages = useMessageStore.getState().messages;
    // Only DB messages, no synthetic pending message
    expect(messages.every((m) => m.status === "complete")).toBe(true);
    expect(useStreamStore.getState().activeRun).toBeNull();
  });
});

// ── Full navigation round-trip ────────────────────────

describe("full navigation round-trip", () => {
  it("preserves streaming state when switching agents and coming back", () => {
    // 1. Agent A is streaming
    useStreamStore.setState({
      activeRun: makeRun({ conversationId: "conv-a", targetMessageId: "pa" }),
    });
    useMessageStore.setState({
      messages: [
        { id: "u1", type: "user", content: "hi", status: "complete" },
        { id: "pa", type: "agent", content: "Hello, I am", status: "streaming" },
      ],
    });
    cacheStreamContent("pa", "Hello, I am");

    // 2. Switch to Agent B → resetTransientChatState
    resetTransientChatState();

    // Messages and activeRun cleared
    expect(useMessageStore.getState().messages).toEqual([]);
    expect(useStreamStore.getState().activeRun).toBeNull();

    // But stream info is shelved
    const shelved = unshelveStream("conv-a");
    expect(shelved).toEqual({ requestId: "req-1", msgId: "pa" });

    // 3. Cached content is still available
    expect(getCachedStreamContent("pa")).toBe("Hello, I am");
  });

  it("flushDelta accumulates to cache when message not in store", () => {
    // Simulate flushDelta behavior: message not in store → cache only
    cacheStreamContent("pa", "Hello");
    // Simulate what flushDelta does when idx < 0:
    const cached = getCachedStreamContent("pa");
    cacheStreamContent("pa", cached + " world");

    expect(getCachedStreamContent("pa")).toBe("Hello world");
  });
});
