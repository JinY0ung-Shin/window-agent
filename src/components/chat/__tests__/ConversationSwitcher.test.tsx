import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import ConversationSwitcher from "../ConversationSwitcher";
import { useConversationStore } from "../../../stores/conversationStore";
import { useAgentStore } from "../../../stores/agentStore";
import { useBootstrapStore } from "../../../stores/bootstrapStore";
import { useStreamStore } from "../../../stores/streamStore";
import { useToolRunStore } from "../../../stores/toolRunStore";
import { useMessageStore } from "../../../stores/messageStore";

vi.mock("../../../services/tauriCommands");

const AGENT = {
  id: "a1",
  folder_name: "test",
  name: "TestAgent",
  avatar: null,
  description: "",
  model: null,
  temperature: null,
  thinking_enabled: null,
  thinking_budget: null,
  is_default: false,
  sort_order: 0,
  created_at: "",
  updated_at: "",
};

const NOW = new Date().toISOString();
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

const CONV1 = { id: "c1", title: "첫 대화", agent_id: "a1", created_at: NOW, updated_at: NOW };
const CONV2 = { id: "c2", title: "두번째 대화", agent_id: "a1", created_at: YESTERDAY, updated_at: YESTERDAY };

const initialConvState = useConversationStore.getState();
const initialAgentState = useAgentStore.getState();
const initialBootstrapState = useBootstrapStore.getState();
const initialStreamState = useStreamStore.getState();
const initialToolState = useToolRunStore.getState();
const initialMsgState = useMessageStore.getState();

beforeEach(() => {
  useConversationStore.setState(initialConvState, true);
  useAgentStore.setState({ ...initialAgentState, agents: [] }, true);
  useBootstrapStore.setState(initialBootstrapState, true);
  useStreamStore.setState(initialStreamState, true);
  useToolRunStore.setState(initialToolState, true);
  useMessageStore.setState(initialMsgState, true);
});

describe("ConversationSwitcher", () => {
  it("shows agent name when no conversation exists", () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: null, conversations: [] });
    render(<ConversationSwitcher />);
    expect(screen.getByText("TestAgent")).toBeInTheDocument();
  });

  it("shows conversation title when conversation is active", () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1] });
    render(<ConversationSwitcher />);
    expect(screen.getByText("첫 대화")).toBeInTheDocument();
  });

  it("shows chevron when agent has conversations", () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1] });
    render(<ConversationSwitcher />);
    expect(document.querySelector(".conversation-switcher-chevron")).toBeInTheDocument();
  });

  it("does not show chevron when no conversations", () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: null, conversations: [] });
    render(<ConversationSwitcher />);
    expect(document.querySelector(".conversation-switcher-chevron")).not.toBeInTheDocument();
  });

  it("opens dropdown on click and shows conversations", async () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1, CONV2] });
    render(<ConversationSwitcher />);

    await act(async () => {
      fireEvent.click(screen.getByText("첫 대화"));
    });

    expect(document.querySelector(".conversation-switcher-dropdown")).toBeInTheDocument();
    expect(screen.getByText("두번째 대화")).toBeInTheDocument();
  });

  it("marks current conversation as active in dropdown", async () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1, CONV2] });
    render(<ConversationSwitcher />);

    await act(async () => {
      fireEvent.click(screen.getByText("첫 대화"));
    });

    const activeItem = document.querySelector(".conv-item.active");
    expect(activeItem).toBeInTheDocument();
    expect(activeItem?.textContent).toBe("첫 대화");
  });

  it("closes dropdown on Escape", async () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1] });
    render(<ConversationSwitcher />);

    await act(async () => {
      fireEvent.click(screen.getByText("첫 대화"));
    });
    expect(document.querySelector(".conversation-switcher-dropdown")).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(document.querySelector(".conversation-switcher-dropdown")).not.toBeInTheDocument();
  });

  it("disables items when busy (activeRun)", async () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1, CONV2] });
    useStreamStore.setState({
      activeRun: { requestId: "r1", conversationId: "c1", targetMessageId: "m1", status: "streaming" },
    });
    render(<ConversationSwitcher />);

    await act(async () => {
      fireEvent.click(screen.getByText("첫 대화"));
    });

    const items = document.querySelectorAll(".conv-item.disabled");
    expect(items.length).toBeGreaterThan(0);
  });

  it("disables new-conversation button when busy (tool running)", () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1, CONV2] });
    useToolRunStore.setState({ toolRunState: "tool_running" });
    render(<ConversationSwitcher />);

    const newBtn = document.querySelector(".conversation-switcher-new:disabled");
    expect(newBtn).toBeInTheDocument();
  });

  it("shows optimistic entry for newly created conversation not yet in store", () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c-new", conversations: [CONV1] });
    useMessageStore.setState({
      messages: [{ id: "m1", type: "user", content: "새 질문입니다", status: "complete" }],
    });
    render(<ConversationSwitcher />);

    // The title should show the optimistic entry's title (from first user message)
    expect(screen.getByText("새 질문입니다")).toBeInTheDocument();
  });

  it("hides dropdown during bootstrapping", () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1] });
    useBootstrapStore.setState({ isBootstrapping: true, bootstrapFolderName: "test" });
    render(<ConversationSwitcher />);
    expect(document.querySelector(".conversation-switcher-chevron")).not.toBeInTheDocument();
  });

  it("shows date group headers", async () => {
    useAgentStore.setState({ selectedAgentId: "a1", agents: [AGENT] });
    useConversationStore.setState({ currentConversationId: "c1", conversations: [CONV1, CONV2] });
    render(<ConversationSwitcher />);

    await act(async () => {
      fireEvent.click(screen.getByText("첫 대화"));
    });

    expect(screen.getByText("오늘")).toBeInTheDocument();
    expect(screen.getByText("어제")).toBeInTheDocument();
  });
});
