import { describe, it, expect, beforeEach } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { useConversationStore } from "../conversationStore";
import { useMessageStore } from "../messageStore";
import { useStreamStore } from "../streamStore";
import { useBootstrapStore } from "../bootstrapStore";
import { useToolRunStore } from "../toolRunStore";
import { useSummaryStore } from "../summaryStore";
import { useChatFlowStore } from "../chatFlowStore";
import { useSettingsStore } from "../settingsStore";
import { useAgentStore } from "../agentStore";
import * as cmds from "../../services/tauriCommands";

vi.mock("../../services/tauriCommands");
vi.mock("../../services/personaService", () => ({
  FILE_NAME_MAP: { identity: "IDENTITY.md", soul: "SOUL.md", user: "USER.md", agents: "AGENTS.md", tools: "TOOLS.md" },
  readPersonaFiles: vi.fn().mockResolvedValue({ identity: "", soul: "", user: "", agents: "", tools: "" }),
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
    apiMessages: [{ role: "system", content: "prompt" }, { role: "user", content: "hi" }, { role: "assistant", content: "response" }],
    responseText: "bootstrap response",
    filesWritten: [],
  }),
  parseAgentName: vi.fn().mockReturnValue("New Agent"),
  isBootstrapComplete: vi.fn().mockReturnValue(false),
}));

const initialConvState = useConversationStore.getState();
const initialMsgState = useMessageStore.getState();
const initialStreamState = useStreamStore.getState();
const initialBootstrapState = useBootstrapStore.getState();
const initialToolRunState = useToolRunStore.getState();
const initialSummaryState = useSummaryStore.getState();
const initialSettingsState = useSettingsStore.getState();
const initialAgentState = useAgentStore.getState();

beforeEach(() => {
  useConversationStore.setState(initialConvState, true);
  useMessageStore.setState(initialMsgState, true);
  useStreamStore.setState(initialStreamState, true);
  useBootstrapStore.setState(initialBootstrapState, true);
  useToolRunStore.setState(initialToolRunState, true);
  useSummaryStore.setState(initialSummaryState, true);
  useSettingsStore.setState({ ...initialSettingsState, envLoaded: true, hasApiKey: false }, true);
  useAgentStore.setState(initialAgentState, true);
  vi.clearAllMocks();
});

describe("chat stores (integrated)", () => {
  it("has correct initial state", () => {
    expect(useConversationStore.getState().conversations).toEqual([]);
    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(useMessageStore.getState().messages).toEqual([]);
    expect(useMessageStore.getState().inputValue).toBe("");
  });

  it("setInputValue updates inputValue", () => {
    useMessageStore.getState().setInputValue("hello");
    expect(useMessageStore.getState().inputValue).toBe("hello");
  });

  it("loadConversations fetches and sets conversations", async () => {
    const mockConvs = [
      { id: "1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "" },
      { id: "2", title: "Conv 2", agent_id: "a1", created_at: "", updated_at: "" },
    ];
    vi.mocked(cmds.getConversations).mockResolvedValue(mockConvs);

    await useConversationStore.getState().loadConversations();
    expect(useConversationStore.getState().conversations).toEqual(mockConvs);
  });

  it("selectConversation fetches messages and maps roles", async () => {
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Test", agent_id: "a1", created_at: "", updated_at: "",
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
    expect(useSummaryStore.getState().currentSummary).toBe("test summary");
    expect(useSummaryStore.getState().summaryUpToMessageId).toBe("m1");
  });

  it("createNewConversation resets state", () => {
    useConversationStore.setState({ currentConversationId: "x" });
    useMessageStore.setState({ messages: [{ id: "1", type: "user", content: "a" }] });
    useConversationStore.getState().createNewConversation();
    expect(useConversationStore.getState().currentConversationId).toBeNull();
  });

  it("deleteConversation removes and reloads", async () => {
    vi.mocked(cmds.deleteConversation).mockResolvedValue(undefined);
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    useConversationStore.setState({ currentConversationId: "x" });
    useMessageStore.setState({ messages: [{ id: "1", type: "user", content: "a" }] });
    await useConversationStore.getState().deleteConversation("x");

    expect(cmds.deleteConversation).toHaveBeenCalledWith("x");
    expect(useConversationStore.getState().currentConversationId).toBeNull();
  });

  it("deleteConversation preserves current if different", async () => {
    vi.mocked(cmds.deleteConversation).mockResolvedValue(undefined);
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    useConversationStore.setState({ currentConversationId: "y" });
    await useConversationStore.getState().deleteConversation("x");
    expect(useConversationStore.getState().currentConversationId).toBe("y");
  });

  it("sendMessage does nothing for empty input", async () => {
    useMessageStore.setState({ inputValue: "   " });
    await useChatFlowStore.getState().sendMessage();
    expect(cmds.createConversation).not.toHaveBeenCalled();
  });

  it("sendMessage opens settings when no API key", async () => {
    useSettingsStore.setState({ hasApiKey: false });
    useMessageStore.setState({ inputValue: "test" });
    await useChatFlowStore.getState().sendMessage();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });

  it("sendMessage auto-creates conversation and saves messages", async () => {
    useSettingsStore.setState({ hasApiKey: true, thinkingEnabled: false });
    useAgentStore.setState({
      selectedAgentId: "agent-1",
      agents: [{ id: "agent-1", folder_name: "test", name: "Test", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
    useMessageStore.setState({ inputValue: "hello" });
    useConversationStore.setState({ currentConversationId: null });

    vi.mocked(cmds.createConversation).mockResolvedValue({
      id: "new-conv", title: "hello", agent_id: "agent-1", created_at: "", updated_at: "",
    });
    vi.mocked(cmds.saveMessage).mockResolvedValueOnce({
      id: "user-msg", conversation_id: "new-conv", role: "user", content: "hello", created_at: "",
    }).mockResolvedValueOnce({
      id: "ai-msg", conversation_id: "new-conv", role: "assistant", content: "AI 응답", created_at: "",
    });
    vi.mocked(cmds.chatCompletionStream).mockResolvedValue(undefined);
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    // Re-mock listen: track handlers and fire done after stream starts
    let chunkHandler: any = null;
    let doneHandler: any = null;
    vi.mocked(listen).mockImplementation(async (event: string, handler: any) => {
      if (event === "chat-stream-chunk") chunkHandler = handler;
      if (event === "chat-stream-done") doneHandler = handler;
      return vi.fn();
    });

    vi.mocked(cmds.chatCompletionStream).mockImplementation(async (req) => {
      // Simulate done event after stream command is called
      if (doneHandler) {
        doneHandler({
          payload: {
            request_id: req.request_id,
            full_content: "AI 응답",
            reasoning_content: null,
            error: null,
          },
        });
      }
    });

    await useChatFlowStore.getState().sendMessage();

    expect(cmds.createConversation).toHaveBeenCalledWith("agent-1", "hello");
    expect(cmds.saveMessage).toHaveBeenCalledTimes(2);
    expect(useMessageStore.getState().inputValue).toBe("");
  });

  it("prepareForAgent sets agent and resets conversation", () => {
    useConversationStore.setState({ currentConversationId: "existing-conv" });
    useMessageStore.setState({ messages: [{ id: "1", type: "user", content: "old" }] });
    useBootstrapStore.setState({ isBootstrapping: true });

    useChatFlowStore.getState().prepareForAgent("agent-42");

    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(useMessageStore.getState().messages).toEqual([]);
    expect(useBootstrapStore.getState().isBootstrapping).toBe(false);
    expect(useAgentStore.getState().selectedAgentId).toBe("agent-42");
  });

  it("startBootstrap sets bootstrap state", async () => {
    vi.mocked(cmds.getBootstrapPrompt).mockResolvedValue("bootstrap system prompt");

    await useBootstrapStore.getState().startBootstrap();

    const s = useBootstrapStore.getState();
    expect(s.isBootstrapping).toBe(true);
    expect(s.bootstrapFolderName).toMatch(/^agent-\d+$/);
    expect(s.bootstrapApiHistory).toHaveLength(1);
    expect(s.bootstrapApiHistory[0].role).toBe("system");
  });

  it("cancelBootstrap resets bootstrap state", () => {
    useBootstrapStore.setState({
      isBootstrapping: true,
      bootstrapFolderName: "agent-123",
      bootstrapApiHistory: [{ role: "system", content: "prompt" }],
      bootstrapFilesWritten: ["IDENTITY.md"],
    });

    useBootstrapStore.getState().cancelBootstrap();

    const s = useBootstrapStore.getState();
    expect(s.isBootstrapping).toBe(false);
    expect(s.bootstrapFolderName).toBeNull();
    expect(s.bootstrapApiHistory).toEqual([]);
    expect(s.bootstrapFilesWritten).toEqual([]);
  });

  it("sendMessage routes to bootstrap when isBootstrapping", async () => {
    useSettingsStore.setState({ hasApiKey: true });
    useMessageStore.setState({ inputValue: "bootstrap input" });
    useBootstrapStore.setState({
      isBootstrapping: true,
      bootstrapFolderName: "agent-999",
      bootstrapApiHistory: [{ role: "system", content: "prompt" }],
    });

    await useChatFlowStore.getState().sendMessage();

    expect(cmds.createConversation).not.toHaveBeenCalled();
    expect(useMessageStore.getState().inputValue).toBe("");
  });
});
