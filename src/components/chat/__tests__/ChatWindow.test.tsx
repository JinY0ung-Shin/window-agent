import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatWindow from "../ChatWindow";
import { useChatStore } from "../../../stores/chatStore";
import { useAgentStore } from "../../../stores/agentStore";

vi.mock("../../../services/tauriCommands");
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));

const initialChatState = useChatStore.getState();
const initialAgentState = useAgentStore.getState();

beforeEach(() => {
  useChatStore.setState(initialChatState, true);
  useAgentStore.setState({ ...initialAgentState, agents: [] }, true);
});

describe("ChatWindow", () => {
  it("shows agent selector when no conversation and no agent selected", () => {
    useChatStore.setState({ messages: [], currentConversationId: null });
    useAgentStore.setState({ selectedAgentId: null, agents: [] });
    render(<ChatWindow />);
    expect(screen.getByText("에이전트 선택")).toBeInTheDocument();
  });

  it("renders messages when present", () => {
    useAgentStore.setState({ selectedAgentId: "a1" });
    useChatStore.setState({
      messages: [
        { id: "1", type: "user", content: "질문입니다" },
        { id: "2", type: "agent", content: "답변입니다" },
      ],
    });
    render(<ChatWindow />);
    expect(screen.getByText("질문입니다")).toBeInTheDocument();
    expect(screen.getByText("답변입니다")).toBeInTheDocument();
  });

  it("shows default title when no conversation and no agent selected", () => {
    useChatStore.setState({ currentConversationId: null, messages: [] });
    useAgentStore.setState({ selectedAgentId: null, agents: [] });
    render(<ChatWindow />);
    // Agent selector is shown, not the title
    expect(screen.getByText("에이전트 선택")).toBeInTheDocument();
  });

  it("shows conversation title from current conversation", () => {
    useChatStore.setState({
      currentConversationId: "c1",
      conversations: [{ id: "c1", title: "내 대화", agent_id: "a1", created_at: "", updated_at: "" }],
    });
    render(<ChatWindow />);
    expect(screen.getByText("내 대화")).toBeInTheDocument();
  });
});
