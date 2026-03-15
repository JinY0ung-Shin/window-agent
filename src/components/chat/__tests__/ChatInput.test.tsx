import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

  // ── IME composition tests ──

  it("does not update store during IME composition", () => {
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ㅎ" } });
    fireEvent.change(input, { target: { value: "하" } });
    fireEvent.change(input, { target: { value: "한" } });
    // Store should NOT be updated during composition
    expect(useMessageStore.getState().inputValue).toBe("");
  });

  it("flushes composed value to store on compositionEnd", () => {
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "한" } });
    fireEvent.compositionEnd(input, { target: input });
    // After compositionEnd, store should have the final value
    // Note: compositionEnd reads from e.target.value which is the DOM value
    expect(useMessageStore.getState().inputValue).toBe("한");
  });

  it("Enter during composition does not send", () => {
    const sendSpy = vi.fn();
    useMessageStore.setState({ inputValue: "기존 텍스트" });
    useChatFlowStore.setState({ sendMessage: sendSpy });
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("flushes localValue to store before sending via button click", () => {
    const sendSpy = vi.fn();
    useChatFlowStore.setState({ sendMessage: sendSpy });
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...");

    // Type normally (not composing)
    fireEvent.change(input, { target: { value: "테스트" } });
    expect(useMessageStore.getState().inputValue).toBe("테스트");

    const sendBtn = screen.getByRole("button");
    fireEvent.click(sendBtn);
    expect(sendSpy).toHaveBeenCalled();
    // Store should have the value before send
    expect(useMessageStore.getState().inputValue).toBe("테스트");
  });

  it("syncs local state when store is cleared externally", () => {
    useMessageStore.setState({ inputValue: "초기값" });
    render(<ChatInput />);
    const input = screen.getByPlaceholderText("메시지를 입력하세요...") as HTMLTextAreaElement;
    expect(input.value).toBe("초기값");

    // Simulate external store clear (e.g., after sending)
    act(() => {
      useMessageStore.setState({ inputValue: "" });
    });
    // Re-render triggers useEffect sync
    expect(input.value).toBe("");
  });
});
