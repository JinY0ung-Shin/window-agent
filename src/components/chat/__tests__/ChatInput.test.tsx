import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatInput from "../ChatInput";
import { useMessageStore } from "../../../stores/messageStore";
import { useChatFlowStore } from "../../../stores/chatFlowStore";
import { useToolRunStore } from "../../../stores/toolRunStore";

vi.mock("../../../services/tauriCommands");

const initialMsgState = useMessageStore.getState();
const initialFlowState = useChatFlowStore.getState();
const initialToolState = useToolRunStore.getState();

beforeEach(() => {
  useMessageStore.setState(initialMsgState, true);
  useChatFlowStore.setState(initialFlowState, true);
  useToolRunStore.setState(initialToolState, true);
});

describe("ChatInput", () => {
  it("renders input field and send button", () => {
    render(<ChatInput />);
    expect(screen.getByPlaceholderText("메시지를 입력하세요...")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    useMessageStore.setState({ inputValue: "" });
    render(<ChatInput />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows cancel button while sending", () => {
    useMessageStore.setState({
      inputValue: "test",
      messages: [{ id: "1", type: "agent", content: "...", status: "pending" as const }],
    });
    render(<ChatInput />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("cancel");
    expect(btn).not.toBeDisabled();
  });

  it("typing updates store inputValue", () => {
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.change(input, { target: { value: "hello" } });
    expect(useMessageStore.getState().inputValue).toBe("hello");
  });

  it("Enter key triggers sendMessage", () => {
    const sendSpy = vi.fn();
    useMessageStore.setState({ inputValue: "test" });
    useChatFlowStore.setState({ sendMessage: sendSpy });
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sendSpy).toHaveBeenCalled();
  });

  it("Shift+Enter does not send message", () => {
    const sendSpy = vi.fn();
    useMessageStore.setState({ inputValue: "test" });
    useChatFlowStore.setState({ sendMessage: sendSpy });
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("send button enabled when input has content and not loading", () => {
    useMessageStore.setState({ inputValue: "hello", messages: [] });
    render(<ChatInput />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
