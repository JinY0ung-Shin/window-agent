import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "../chatStore";
import { useSettingsStore } from "../settingsStore";
import { useAgentStore } from "../agentStore";
import * as cmds from "../../services/tauriCommands";

vi.mock("../../services/tauriCommands");
vi.mock("../../services/personaService", () => ({
  FILE_NAME_MAP: { identity: "IDENTITY.md", soul: "SOUL.md", user: "USER.md", agents: "AGENTS.md" },
  readPersonaFiles: vi.fn().mockResolvedValue({ identity: "", soul: "", user: "", agents: "" }),
  assembleSystemPrompt: vi.fn().mockReturnValue("mock prompt"),
  assembleManagerPrompt: vi.fn().mockReturnValue("mock prompt"),
  invalidatePersonaCache: vi.fn(),
  getEffectiveSettings: vi.fn().mockReturnValue({
    model: "test-model",
    temperature: null,
    thinkingEnabled: false,
    thinkingBudget: 4096,
    apiKey: "test-key",
    baseUrl: "",
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
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "AI 응답" } }],
          }),
        },
      };
    },
  };
});

const initialChatState = useChatStore.getState();
const initialSettingsState = useSettingsStore.getState();
const initialAgentState = useAgentStore.getState();

beforeEach(() => {
  useChatStore.setState(initialChatState, true);
  useSettingsStore.setState({ ...initialSettingsState, envLoaded: true }, true);
  useAgentStore.setState(initialAgentState, true);
  vi.clearAllMocks();
});

describe("chatStore", () => {
  it("has correct initial state", () => {
    const s = useChatStore.getState();
    expect(s.conversations).toEqual([]);
    expect(s.currentConversationId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.inputValue).toBe("");
  });

  it("setInputValue updates inputValue", () => {
    useChatStore.getState().setInputValue("hello");
    expect(useChatStore.getState().inputValue).toBe("hello");
  });

  it("loadConversations fetches and sets conversations", async () => {
    const mockConvs = [
      { id: "1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "" },
      { id: "2", title: "Conv 2", agent_id: "a1", created_at: "", updated_at: "" },
    ];
    vi.mocked(cmds.getConversations).mockResolvedValue(mockConvs);

    await useChatStore.getState().loadConversations();
    expect(useChatStore.getState().conversations).toEqual(mockConvs);
  });

  it("selectConversation fetches messages and maps roles", async () => {
    vi.mocked(cmds.getMessages).mockResolvedValue([
      { id: "m1", conversation_id: "c1", role: "user", content: "hi", created_at: "" },
      { id: "m2", conversation_id: "c1", role: "assistant", content: "hello", created_at: "" },
    ]);

    await useChatStore.getState().selectConversation("c1");
    const s = useChatStore.getState();
    expect(s.currentConversationId).toBe("c1");
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].type).toBe("user");
    expect(s.messages[1].type).toBe("agent");
  });

  it("createNewConversation resets state", () => {
    useChatStore.setState({ currentConversationId: "x", messages: [{ id: "1", type: "user", content: "a" }] });
    useChatStore.getState().createNewConversation();
    expect(useChatStore.getState().currentConversationId).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("deleteConversation removes and reloads", async () => {
    vi.mocked(cmds.deleteConversation).mockResolvedValue(undefined);
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    useChatStore.setState({ currentConversationId: "x", messages: [{ id: "1", type: "user", content: "a" }] });
    await useChatStore.getState().deleteConversation("x");

    expect(cmds.deleteConversation).toHaveBeenCalledWith("x");
    expect(useChatStore.getState().currentConversationId).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("deleteConversation preserves current if different", async () => {
    vi.mocked(cmds.deleteConversation).mockResolvedValue(undefined);
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    useChatStore.setState({ currentConversationId: "y" });
    await useChatStore.getState().deleteConversation("x");
    expect(useChatStore.getState().currentConversationId).toBe("y");
  });

  it("sendMessage does nothing for empty input", async () => {
    useChatStore.setState({ inputValue: "   " });
    await useChatStore.getState().sendMessage();
    expect(cmds.createConversation).not.toHaveBeenCalled();
  });

  it("sendMessage opens settings when no API key", async () => {
    useSettingsStore.setState({ apiKey: "" });
    useChatStore.setState({ inputValue: "test" });
    await useChatStore.getState().sendMessage();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });

  it("sendMessage auto-creates conversation and saves messages", async () => {
    useSettingsStore.setState({ apiKey: "test-key", thinkingEnabled: false });
    useAgentStore.setState({
      selectedAgentId: "agent-1",
      agents: [{ id: "agent-1", folder_name: "test", name: "Test", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
    useChatStore.setState({ inputValue: "hello", currentConversationId: null });

    vi.mocked(cmds.createConversation).mockResolvedValue({
      id: "new-conv", title: "hello", agent_id: "agent-1", created_at: "", updated_at: "",
    });
    vi.mocked(cmds.saveMessage).mockResolvedValueOnce({
      id: "user-msg", conversation_id: "new-conv", role: "user", content: "hello", created_at: "",
    }).mockResolvedValueOnce({
      id: "ai-msg", conversation_id: "new-conv", role: "assistant", content: "AI 응답", created_at: "",
    });
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    await useChatStore.getState().sendMessage();

    expect(cmds.createConversation).toHaveBeenCalledWith("agent-1", "hello");
    expect(cmds.saveMessage).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().inputValue).toBe("");
  });

  it("prepareForAgent sets agent and resets conversation", () => {
    useChatStore.setState({
      currentConversationId: "existing-conv",
      messages: [{ id: "1", type: "user", content: "old" }],
      isBootstrapping: true,
    });

    useChatStore.getState().prepareForAgent("agent-42");

    const s = useChatStore.getState();
    expect(s.currentConversationId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.isBootstrapping).toBe(false);
    expect(useAgentStore.getState().selectedAgentId).toBe("agent-42");
  });

  it("startBootstrap sets bootstrap state", async () => {
    vi.mocked(cmds.getBootstrapPrompt).mockResolvedValue("bootstrap system prompt");

    await useChatStore.getState().startBootstrap();

    const s = useChatStore.getState();
    expect(s.isBootstrapping).toBe(true);
    expect(s.bootstrapFolderName).toMatch(/^agent-\d+$/);
    expect(s.bootstrapApiHistory).toHaveLength(1);
    expect(s.bootstrapApiHistory[0].role).toBe("system");
    expect(s.messages).toEqual([]);
  });

  it("cancelBootstrap resets bootstrap state", () => {
    useChatStore.setState({
      isBootstrapping: true,
      bootstrapFolderName: "agent-123",
      bootstrapApiHistory: [{ role: "system", content: "prompt" }],
      bootstrapFilesWritten: ["IDENTITY.md"],
      messages: [{ id: "1", type: "user", content: "hello" }],
    });

    useChatStore.getState().cancelBootstrap();

    const s = useChatStore.getState();
    expect(s.isBootstrapping).toBe(false);
    expect(s.bootstrapFolderName).toBeNull();
    expect(s.bootstrapApiHistory).toEqual([]);
    expect(s.bootstrapFilesWritten).toEqual([]);
    expect(s.messages).toEqual([]);
  });

  it("sendMessage routes to bootstrap when isBootstrapping", async () => {
    useSettingsStore.setState({ apiKey: "test-key" });
    useChatStore.setState({
      inputValue: "bootstrap input",
      isBootstrapping: true,
      bootstrapFolderName: "agent-999",
      bootstrapApiHistory: [{ role: "system", content: "prompt" }],
    });

    // sendMessage will call sendBootstrapMessage which uses executeBootstrapTurn
    // Since bootstrapFolderName is set and isBootstrapping=true, it should route there.
    // The bootstrap path will attempt to call executeBootstrapTurn via the openai mock
    // We just verify it did NOT call createConversation (normal path)
    await useChatStore.getState().sendMessage();

    expect(cmds.createConversation).not.toHaveBeenCalled();
    // Input should be cleared by the bootstrap path
    expect(useChatStore.getState().inputValue).toBe("");
  });
});
