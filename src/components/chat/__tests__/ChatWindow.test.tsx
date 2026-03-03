import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatWindow from "../ChatWindow";
import { useChatStore } from "../../../stores/chatStore";

vi.mock("../../../services/tauriCommands");
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));

const initialState = useChatStore.getState();

beforeEach(() => {
  useChatStore.setState(initialState, true);
});

describe("ChatWindow", () => {
  it("shows welcome message when no messages", () => {
    useChatStore.setState({ messages: [] });
    render(<ChatWindow />);
    expect(screen.getByText(/안녕하세요/)).toBeInTheDocument();
  });

  it("renders messages when present", () => {
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

  it("shows default title when no conversation selected", () => {
    useChatStore.setState({ currentConversationId: null });
    render(<ChatWindow />);
    expect(screen.getByText("업무 보조 에이전트")).toBeInTheDocument();
  });

  it("shows conversation title from current conversation", () => {
    useChatStore.setState({
      currentConversationId: "c1",
      conversations: [{ id: "c1", title: "내 대화", created_at: "", updated_at: "" }],
    });
    render(<ChatWindow />);
    expect(screen.getByText("내 대화")).toBeInTheDocument();
  });
});
