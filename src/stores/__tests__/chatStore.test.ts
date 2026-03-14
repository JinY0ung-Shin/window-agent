import { describe, it, expect, beforeEach } from "vitest";
import { listen } from "@tauri-apps/api/event";
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

const initialChatState = useChatStore.getState();
const initialSettingsState = useSettingsStore.getState();
const initialAgentState = useAgentStore.getState();

beforeEach(() => {
  useChatStore.setState(initialChatState, true);
  useSettingsStore.setState({ ...initialSettingsState, envLoaded: true, hasApiKey: false }, true);
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
    vi.mocked(cmds.getConversationDetail).mockResolvedValue({
      id: "c1", title: "Test", agent_id: "a1", created_at: "", updated_at: "",
      summary: "test summary", summary_up_to_message_id: "m1",
    });
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
    expect(s.currentSummary).toBe("test summary");
    expect(s.summaryUpToMessageId).toBe("m1");
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
    useSettingsStore.setState({ hasApiKey: false });
    useChatStore.setState({ inputValue: "test" });
    await useChatStore.getState().sendMessage();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });

  it("sendMessage auto-creates conversation and saves messages", async () => {
    useSettingsStore.setState({ hasApiKey: true, thinkingEnabled: false });
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
    vi.mocked(cmds.chatCompletionStream).mockResolvedValue(undefined);
    vi.mocked(cmds.getConversations).mockResolvedValue([]);

    // Mock listen: capture callbacks, invoke done immediately
    vi.mocked(listen).mockImplementation(async (event: string, handler: any) => {
      if (event === "chat-stream-done") {
        // Fire done event on next tick so stream command runs first
        setTimeout(() => {
          handler({
            payload: {
              request_id: expect.any(String),
              full_content: "AI 응답",
              reasoning_content: null,
              error: null,
            },
          });
        }, 0);
        // Also match any request_id by capturing and replaying
        const origHandler = handler;
        vi.mocked(listen).mockImplementation(async (evt: string, h: any) => {
          if (evt === "chat-stream-done") {
            setTimeout(() => {
              // Use the actual request_id from state
              const activeRun = useChatStore.getState().activeRun;
              origHandler({
                payload: {
                  request_id: activeRun?.requestId ?? "",
                  full_content: "AI 응답",
                  reasoning_content: null,
                  error: null,
                },
              });
            }, 0);
          }
          return vi.fn();
        });
      }
      return vi.fn();
    });

    // Re-mock listen more simply: track handlers and fire done after stream starts
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
    useSettingsStore.setState({ hasApiKey: true });
    useChatStore.setState({
      inputValue: "bootstrap input",
      isBootstrapping: true,
      bootstrapFolderName: "agent-999",
      bootstrapApiHistory: [{ role: "system", content: "prompt" }],
    });

    await useChatStore.getState().sendMessage();

    expect(cmds.createConversation).not.toHaveBeenCalled();
    expect(useChatStore.getState().inputValue).toBe("");
  });
});
