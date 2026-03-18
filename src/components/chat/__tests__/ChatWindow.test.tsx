import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import ChatWindow from "../ChatWindow";
import { useMessageStore } from "../../../stores/messageStore";
import { useConversationStore } from "../../../stores/conversationStore";
import { useBootstrapStore } from "../../../stores/bootstrapStore";
import { useAgentStore } from "../../../stores/agentStore";
import { useToolRunStore } from "../../../stores/toolRunStore";
import { useStreamStore } from "../../../stores/streamStore";

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
const initialToolState = useToolRunStore.getState();
const initialStreamState = useStreamStore.getState();

function setScrollMetrics(
  element: HTMLElement,
  { scrollTop, scrollHeight = 1000, clientHeight = 400 }: { scrollTop: number; scrollHeight?: number; clientHeight?: number },
) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(element, "scrollTop", { configurable: true, writable: true, value: scrollTop });
}

beforeEach(() => {
  useMessageStore.setState(initialMsgState, true);
  useConversationStore.setState(initialConvState, true);
  useBootstrapStore.setState(initialBootstrapState, true);
  useAgentStore.setState({ ...initialAgentState, agents: [] }, true);
  useToolRunStore.setState(initialToolState, true);
  useStreamStore.setState(initialStreamState, true);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ChatWindow", () => {
  it("shows welcome message when no conversation and no agent selected", () => {
    useMessageStore.setState({ messages: [] });
    useConversationStore.setState({ currentConversationId: null });
    useAgentStore.setState({ selectedAgentId: null, agents: [] });
    render(<ChatWindow />);
    expect(screen.getByText(/직원을 선택하거나 새로 채용하세요/)).toBeInTheDocument();
  });

  it("does not show agent selection UI in welcome state", () => {
    useMessageStore.setState({ messages: [] });
    useConversationStore.setState({ currentConversationId: null });
    useAgentStore.setState({ selectedAgentId: null, agents: [] });
    render(<ChatWindow />);
    expect(screen.queryByText("직원 선택")).not.toBeInTheDocument();
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
    expect(screen.queryByText(/직원을 선택하거나 새로 채용하세요/)).not.toBeInTheDocument();
  });

  it("shows bootstrap UI when bootstrapping", async () => {
    useBootstrapStore.setState({ isBootstrapping: true, bootstrapFolderName: "agent-123" });
    useMessageStore.setState({ messages: [] });
    await act(async () => { render(<ChatWindow />); });
    expect(screen.getByText("채용하기")).toBeInTheDocument();
  });

  it("auto-scrolls when already near the bottom", async () => {
    useAgentStore.setState({
      selectedAgentId: "a1",
      agents: [{ id: "a1", folder_name: "test", name: "MyAgent", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
    useMessageStore.setState({
      messages: [
        { id: "1", type: "agent", content: "첫 답변", status: "complete" },
      ],
    });

    await act(async () => { render(<ChatWindow />); });
    const container = document.querySelector(".chat-container") as HTMLElement;
    setScrollMetrics(container, { scrollTop: 600 });
    fireEvent.scroll(container);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    act(() => {
      useMessageStore.setState({
        messages: [
          { id: "1", type: "agent", content: "첫 답변", status: "complete" },
          { id: "2", type: "agent", content: "둘째 답변", status: "complete" },
        ],
      });
    });

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("stops auto-scroll when the user scrolls upward during updates", async () => {
    useAgentStore.setState({
      selectedAgentId: "a1",
      agents: [{ id: "a1", folder_name: "test", name: "MyAgent", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
    useMessageStore.setState({
      messages: [
        { id: "1", type: "agent", content: "스트리밍 중", status: "streaming" },
      ],
    });

    await act(async () => { render(<ChatWindow />); });
    const container = document.querySelector(".chat-container") as HTMLElement;
    setScrollMetrics(container, { scrollTop: 600 });
    fireEvent.scroll(container);

    setScrollMetrics(container, { scrollTop: 520 });
    fireEvent.scroll(container);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    act(() => {
      useMessageStore.setState({
        messages: [
          { id: "1", type: "agent", content: "스트리밍 중 더 길어진 내용", status: "streaming" },
        ],
      });
    });

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("stops auto-scroll as soon as upward wheel intent is detected", async () => {
    useAgentStore.setState({
      selectedAgentId: "a1",
      agents: [{ id: "a1", folder_name: "test", name: "MyAgent", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });
    useMessageStore.setState({
      messages: [
        { id: "1", type: "agent", content: "스트리밍 중", status: "streaming" },
      ],
    });

    await act(async () => { render(<ChatWindow />); });
    const container = document.querySelector(".chat-container") as HTMLElement;
    setScrollMetrics(container, { scrollTop: 600 });
    fireEvent.scroll(container);

    fireEvent.wheel(container, { deltaY: -40 });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    act(() => {
      useMessageStore.setState({
        messages: [
          { id: "1", type: "agent", content: "스트리밍 중 더 길어진 내용", status: "streaming" },
        ],
      });
    });

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
