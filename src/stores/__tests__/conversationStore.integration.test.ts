import { describe, it, expect, beforeEach } from "vitest";
import { useConversationStore } from "../conversationStore";
import { useMessageStore } from "../messageStore";
import { useAgentStore } from "../agentStore";
import { useMemoryStore } from "../memoryStore";
import { useVaultStore } from "../vaultStore";
import { useDebugStore } from "../debugStore";
import { useSkillStore } from "../skillStore";
import { useSummaryStore } from "../summaryStore";
import { useTeamStore } from "../teamStore";
import { useStreamStore } from "../streamStore";
import { useBootstrapStore } from "../bootstrapStore";
import { useToolRunStore } from "../toolRunStore";
import * as cmds from "../../services/tauriCommands";
import * as lifecycleEvents from "../../services/lifecycleEvents";

vi.mock("../../services/tauriCommands");
vi.mock("../../services/commands/vaultCommands", () => ({
  vaultListNotes: vi.fn().mockResolvedValue([]),
  vaultCreateNote: vi.fn().mockResolvedValue({}),
  vaultReadNote: vi.fn().mockResolvedValue({}),
  vaultUpdateNote: vi.fn().mockResolvedValue({}),
  vaultDeleteNote: vi.fn().mockResolvedValue(undefined),
  vaultSearch: vi.fn().mockResolvedValue([]),
  vaultGetGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  vaultGetBacklinks: vi.fn().mockResolvedValue([]),
  vaultGetPath: vi.fn().mockResolvedValue(""),
  vaultOpenInObsidian: vi.fn().mockResolvedValue(undefined),
  vaultRebuildIndex: vi.fn().mockResolvedValue({ totalNotes: 0, totalLinks: 0, brokenLinks: 0 }),
}));
vi.mock("../../services/consolidationService", () => ({
  consolidateConversation: vi.fn().mockResolvedValue(undefined),
  recoverPendingConsolidations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/lifecycleEvents", () => ({
  emitLifecycleEvent: vi.fn(),
}));
vi.mock("../../services/personaService", () => ({
  FILE_NAME_MAP: { identity: "IDENTITY.md", soul: "SOUL.md", user: "USER.md", agents: "AGENTS.md", tools: "TOOLS.md" },
  readPersonaFiles: vi.fn().mockResolvedValue({ identity: "", soul: "", user: "", agents: "", tools: "" }),
  readBootFile: vi.fn().mockResolvedValue(null),
  assembleSystemPrompt: vi.fn().mockReturnValue("mock prompt"),
  assembleManagerPrompt: vi.fn().mockReturnValue("mock prompt"),
  invalidatePersonaCache: vi.fn(),
  getEffectiveSettings: vi.fn().mockReturnValue({
    model: "test-model",
    temperature: null,
    thinkingEnabled: false,
    thinkingBudget: 4096,
  }),
}));
vi.mock("../../services/bootstrapService", () => ({
  executeBootstrapTurn: vi.fn().mockResolvedValue({
    apiMessages: [],
    responseText: "bootstrap response",
    filesWritten: [],
  }),
  parseAgentName: vi.fn().mockReturnValue("New Agent"),
  isBootstrapComplete: vi.fn().mockReturnValue(false),
}));

const initialConvState = useConversationStore.getState();
const initialMsgState = useMessageStore.getState();
const initialAgentState = useAgentStore.getState();
const initialMemoryState = useMemoryStore.getState();
const initialDebugState = useDebugStore.getState();
const initialSkillState = useSkillStore.getState();
const initialSummaryState = useSummaryStore.getState();
const initialTeamState = useTeamStore.getState();
const initialStreamState = useStreamStore.getState();
const initialBootstrapState = useBootstrapStore.getState();
const initialToolRunState = useToolRunStore.getState();

const AGENT = { id: "a1", folder_name: "agent-abc", name: "Agent 1", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: true, system_prompt: null };
const CONV1 = { id: "c1", title: "Conv 1", agent_id: "a1", created_at: "2026-01-01", updated_at: "2026-01-01" };
const CONV2 = { id: "c2", title: "Conv 2", agent_id: "a1", created_at: "2026-01-02", updated_at: "2026-01-02" };
const TEAM_CONV = { id: "tc1", title: "Team Conv", agent_id: "a1", team_id: "t1", created_at: "2026-01-01", updated_at: "2026-01-01" };

beforeEach(() => {
  useConversationStore.setState(initialConvState, true);
  useMessageStore.setState(initialMsgState, true);
  useAgentStore.setState({ ...initialAgentState, agents: [AGENT] }, true);
  useMemoryStore.setState(initialMemoryState, true);
  useDebugStore.setState(initialDebugState, true);
  useSkillStore.setState(initialSkillState, true);
  useSummaryStore.setState(initialSummaryState, true);
  useTeamStore.setState(initialTeamState, true);
  useStreamStore.setState(initialStreamState, true);
  useBootstrapStore.setState(initialBootstrapState, true);
  useToolRunStore.setState(initialToolRunState, true);
  vi.clearAllMocks();

  // Default mocks
  vi.mocked(cmds.readConsolidatedMemory).mockResolvedValue(null);
  vi.mocked(cmds.getConversations).mockResolvedValue([CONV1, CONV2]);
  vi.mocked(cmds.getMessages).mockResolvedValue([]);
  vi.mocked(cmds.getConversationDetail).mockResolvedValue({
    ...CONV1,
    summary: undefined,
    summary_up_to_message_id: undefined,
  });
  vi.mocked(cmds.deleteConversation).mockResolvedValue(undefined);
});

describe("selectConversation", () => {
  it("loads messages, maps roles, and syncs to messageStore", async () => {
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "",
      summary: "test summary", summary_up_to_message_id: "m1",
    });
    vi.mocked(cmds.getMessages).mockResolvedValue([
      { id: "m1", conversation_id: "c1", role: "user", content: "hi", created_at: "" },
      { id: "m2", conversation_id: "c1", role: "assistant", content: "hello", created_at: "" },
    ]);

    const result = await useConversationStore.getState().selectConversation("c1");

    expect(useConversationStore.getState().currentConversationId).toBe("c1");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].type).toBe("user");
    expect(result.messages[1].type).toBe("agent");
    expect(useMessageStore.getState().messages).toHaveLength(2);
  });

  it("loads summary into summaryStore", async () => {
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "",
      summary: "the summary", summary_up_to_message_id: "m5",
    });

    await useConversationStore.getState().selectConversation("c1");

    expect(useSummaryStore.getState().currentSummary).toBe("the summary");
    expect(useSummaryStore.getState().summaryUpToMessageId).toBe("m5");
  });

  it("emits session:end for the previous conversation", async () => {
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [CONV1, CONV2],
    });

    await useConversationStore.getState().selectConversation("c2");

    expect(lifecycleEvents.emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session:end", conversationId: "c1", agentId: "a1" }),
    );
  });

  it("emits session:start for the selected conversation", async () => {
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "",
    });

    await useConversationStore.getState().selectConversation("c1");

    expect(lifecycleEvents.emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session:start", conversationId: "c1", agentId: "a1" }),
    );
  });

  it("selects agent and loads debug logs", async () => {
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "",
    });

    await useConversationStore.getState().selectConversation("c1");

    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("filters out __team_synthesis_context tool messages", async () => {
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "",
    });
    vi.mocked(cmds.getMessages).mockResolvedValue([
      { id: "m1", conversation_id: "c1", role: "user", content: "hi", created_at: "" },
      { id: "m2", conversation_id: "c1", role: "tool", content: "ctx", tool_name: "__team_synthesis_context", tool_call_id: "tc1", created_at: "" },
      { id: "m3", conversation_id: "c1", role: "assistant", content: "resp", created_at: "" },
    ]);

    const result = await useConversationStore.getState().selectConversation("c1");

    expect(result.messages).toHaveLength(2);
    expect(result.messages.find((m) => m.tool_name === "__team_synthesis_context")).toBeUndefined();
  });
});

describe("openAgentChat", () => {
  it("selects existing conversation for agent", async () => {
    useConversationStore.setState({ conversations: [CONV1] });
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "",
    });

    await useConversationStore.getState().openAgentChat("a1");

    expect(useConversationStore.getState().currentConversationId).toBe("c1");
  });

  it("prepares empty DM when no conversation exists", async () => {
    useConversationStore.setState({ conversations: [] });

    await useConversationStore.getState().openAgentChat("a1");

    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("ends previous session when switching to empty DM", async () => {
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [CONV1],
    });

    // No conversation for agent a2
    await useConversationStore.getState().openAgentChat("a2");

    expect(lifecycleEvents.emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session:end", conversationId: "c1" }),
    );
  });
});

describe("openTeamChat", () => {
  it("selects existing team conversation", async () => {
    vi.mocked(cmds.getConversations).mockResolvedValue([TEAM_CONV]);
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "tc1", title: "Team Conv", agent_id: "a1", team_id: "t1", created_at: "", updated_at: "",
    });

    await useConversationStore.getState().openTeamChat("t1", "a1");

    expect(useConversationStore.getState().currentConversationId).toBe("tc1");
    expect(useTeamStore.getState().selectedTeamId).toBe("t1");
  });

  it("prepares empty team chat when no conversation exists", async () => {
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    await useConversationStore.getState().openTeamChat("t1", "a1");

    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(useTeamStore.getState().selectedTeamId).toBe("t1");
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("re-selects team after resetChatContext clears it", async () => {
    vi.mocked(cmds.getConversations).mockResolvedValue([]);
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1] });

    await useConversationStore.getState().openTeamChat("t1", "a1");

    // Team should be selected even though resetChatContext was called
    expect(useTeamStore.getState().selectedTeamId).toBe("t1");
  });
});

describe("createNewConversation", () => {
  it("resets conversation and agent selection", () => {
    useConversationStore.setState({ currentConversationId: "c1" });
    useAgentStore.setState({ selectedAgentId: "a1" });
    useMessageStore.setState({ messages: [{ id: "m1", type: "user", content: "hi", status: "complete" }] });

    useConversationStore.getState().createNewConversation();

    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(useAgentStore.getState().selectedAgentId).toBeNull();
    expect(useMessageStore.getState().messages).toEqual([]);
  });

  it("emits session:end for previous conversation", () => {
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [CONV1],
    });

    useConversationStore.getState().createNewConversation();

    expect(lifecycleEvents.emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session:end", conversationId: "c1", agentId: "a1" }),
    );
  });
});

describe("deleteConversation", () => {
  it("deletes and reloads conversations", async () => {
    vi.mocked(cmds.getConversations).mockResolvedValue([]);
    useConversationStore.setState({ conversations: [CONV1] });

    await useConversationStore.getState().deleteConversation("c1");

    expect(cmds.deleteConversation).toHaveBeenCalledWith("c1");
    expect(cmds.getConversations).toHaveBeenCalled();
  });

  it("resets state when deleting active conversation", async () => {
    vi.mocked(cmds.getConversations).mockResolvedValue([]);
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [CONV1],
    });

    await useConversationStore.getState().deleteConversation("c1");

    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(lifecycleEvents.emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session:end", conversationId: "c1" }),
    );
  });

  it("does not reset state when deleting non-active conversation", async () => {
    vi.mocked(cmds.getConversations).mockResolvedValue([CONV1]);
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [CONV1, CONV2],
    });

    await useConversationStore.getState().deleteConversation("c2");

    expect(useConversationStore.getState().currentConversationId).toBe("c1");
    expect(lifecycleEvents.emitLifecycleEvent).not.toHaveBeenCalled();
  });
});

describe("startNewAgentConversation", () => {
  it("resets state and selects agent", async () => {
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [CONV1],
    });

    await useConversationStore.getState().startNewAgentConversation("a1");

    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("emits session:end for previous conversation", async () => {
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [CONV1],
    });

    await useConversationStore.getState().startNewAgentConversation("a1");

    expect(lifecycleEvents.emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session:end", conversationId: "c1", agentId: "a1" }),
    );
  });
});
