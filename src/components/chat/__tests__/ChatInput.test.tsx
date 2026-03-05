import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatInput from "../ChatInput";
import { useChatStore } from "../../../stores/chatStore";

vi.mock("../../../services/tauriCommands");

const initialState = useChatStore.getState();

beforeEach(() => {
  useChatStore.setState(initialState, true);
});

describe("ChatInput", () => {
  it("renders input field and send button", () => {
    render(<ChatInput />);
    expect(screen.getByPlaceholderText("메시지를 입력하세요...")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    useChatStore.setState({ inputValue: "" });
    render(<ChatInput />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("send button is disabled while sending", () => {
    useChatStore.setState({
      inputValue: "test",
      messages: [{ id: "1", type: "agent", content: "...", isLoading: true }],
    });
    render(<ChatInput />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("typing updates store inputValue", () => {
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.change(input, { target: { value: "hello" } });
    expect(useChatStore.getState().inputValue).toBe("hello");
  });

  it("Enter key triggers sendMessage", () => {
    const sendSpy = vi.fn();
    useChatStore.setState({ inputValue: "test", sendMessage: sendSpy });
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sendSpy).toHaveBeenCalled();
  });

  it("Shift+Enter does not send message", () => {
    const sendSpy = vi.fn();
    useChatStore.setState({ inputValue: "test", sendMessage: sendSpy });
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("send button enabled when input has content and not loading", () => {
    useChatStore.setState({ inputValue: "hello", messages: [] });
    render(<ChatInput />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
