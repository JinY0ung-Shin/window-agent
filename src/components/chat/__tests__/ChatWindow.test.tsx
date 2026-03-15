import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ChatWindow from "../ChatWindow";
import { useMessageStore } from "../../../stores/messageStore";
import { useConversationStore } from "../../../stores/conversationStore";
import { useBootstrapStore } from "../../../stores/bootstrapStore";
import { useAgentStore } from "../../../stores/agentStore";

vi.mock("../../../services/tauriCommands");
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));

const initialMsgState = useMessageStore.getState();
const initialConvState = useConversationStore.getState();
const initialBootstrapState = useBootstrapStore.getState();
const initialAgentState = useAgentStore.getState();

beforeEach(() => {
  useMessageStore.setState(initialMsgState, true);
  useConversationStore.setState(initialConvState, true);
  useBootstrapStore.setState(initialBootstrapState, true);
  useAgentStore.setState({ ...initialAgentState, agents: [] }, true);
});

describe("ChatWindow", () => {
  it("shows welcome message when no conversation and no agent selected", () => {
    useMessageStore.setState({ messages: [] });
    useConversationStore.setState({ currentConversationId: null });
    useAgentStore.setState({ selectedAgentId: null, agents: [] });
    render(<ChatWindow />);
    expect(screen.getByText(/사이드바에서 에이전트를 선택/)).toBeInTheDocument();
  });

  it("does not show AgentSelector component", () => {
    useMessageStore.setState({ messages: [] });
    useConversationStore.setState({ currentConversationId: null });
    useAgentStore.setState({ selectedAgentId: null, agents: [] });
    render(<ChatWindow />);
    expect(screen.queryByText("에이전트 선택")).not.toBeInTheDocument();
  });

  it("renders messages when present", async () => {
    useAgentStore.setState({ selectedAgentId: "a1" });
    useMessageStore.setState({
      messages: [
        { id: "1", type: "user", content: "질문입니다" },
        { id: "2", type: "agent", content: "답변입니다" },
      ],
    });
    await act(async () => { render(<ChatWindow />); });
    expect(screen.getByText("질문입니다")).toBeInTheDocument();
    expect(screen.getByText("답변입니다")).toBeInTheDocument();
  });

  it("shows agent name as header when agent is selected but no conversation", () => {
    useConversationStore.setState({ currentConversationId: null });
    useMessageStore.setState({ messages: [] });
    useAgentStore.setState({
      selectedAgentId: "a1",
      agents: [{ id: "a1", folder_name: "test", name: "MyAgent", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
    render(<ChatWindow />);
    // header-title and header-agent-btn both show agent name
    const elements = screen.getAllByText("MyAgent");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows conversation title from current conversation", () => {
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [{ id: "c1", title: "내 대화", agent_id: "a1", created_at: "", updated_at: "" }],
    });
    render(<ChatWindow />);
    expect(screen.getByText("내 대화")).toBeInTheDocument();
  });

  it("shows ChatInput when agent is selected (even without conversation)", () => {
    useConversationStore.setState({ currentConversationId: null });
    useMessageStore.setState({ messages: [] });
    useAgentStore.setState({
      selectedAgentId: "a1",
      agents: [{ id: "a1", folder_name: "test", name: "MyAgent", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
    render(<ChatWindow />);
    // ChatInput should be rendered (not hidden by showSelector)
    expect(screen.queryByText(/사이드바에서 에이전트를 선택/)).not.toBeInTheDocument();
  });

  it("shows bootstrap UI when bootstrapping", async () => {
    useBootstrapStore.setState({ isBootstrapping: true, bootstrapFolderName: "agent-123" });
    useMessageStore.setState({ messages: [] });
    await act(async () => { render(<ChatWindow />); });
    expect(screen.getByText("새 에이전트 만들기")).toBeInTheDocument();
  });
});
