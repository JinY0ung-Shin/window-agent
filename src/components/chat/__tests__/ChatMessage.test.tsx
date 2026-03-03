import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatMessage from "../ChatMessage";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));

describe("ChatMessage", () => {
  it("renders user message content", () => {
    render(<ChatMessage message={{ id: "1", type: "user", content: "안녕하세요" }} />);
    expect(screen.getByText("안녕하세요")).toBeInTheDocument();
  });

  it("renders agent message content", () => {
    render(<ChatMessage message={{ id: "2", type: "agent", content: "도와드릴게요" }} />);
    expect(screen.getByText("도와드릴게요")).toBeInTheDocument();
  });

  it("shows loading dots when isLoading", () => {
    const { container } = render(
      <ChatMessage message={{ id: "3", type: "agent", content: "...", isLoading: true }} />
    );
    expect(container.querySelector(".loading-dots")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
  });

  it("does not show reasoning toggle when no reasoningContent", () => {
    render(<ChatMessage message={{ id: "4", type: "agent", content: "test" }} />);
    expect(screen.queryByText("추론 과정")).not.toBeInTheDocument();
  });

  it("shows reasoning toggle when reasoningContent present", () => {
    render(
      <ChatMessage
        message={{ id: "5", type: "agent", content: "result", reasoningContent: "thinking..." }}
      />
    );
    expect(screen.getByText("추론 과정")).toBeInTheDocument();
  });

  it("clicking reasoning toggle shows and hides reasoning content", () => {
    render(
      <ChatMessage
        message={{ id: "6", type: "agent", content: "result", reasoningContent: "내부 추론" }}
      />
    );
    const toggle = screen.getByText("추론 과정");

    fireEvent.click(toggle);
    expect(screen.getByText("내부 추론")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("내부 추론")).not.toBeInTheDocument();
  });
});
