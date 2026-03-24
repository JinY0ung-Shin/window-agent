import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMessageStore } from "../messageStore";
import type { ChatMessage } from "../../services/types";

const makeMsg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  type: "user",
  content: "hello",
  status: "complete",
  ...overrides,
});

const initial = useMessageStore.getState();

beforeEach(() => {
  useMessageStore.setState(initial, true);
});

describe("messageStore", () => {
  it("setInputValue updates inputValue", () => {
    useMessageStore.getState().setInputValue("test");
    expect(useMessageStore.getState().inputValue).toBe("test");
  });

  it("setMessages replaces messages array", () => {
    const msgs = [makeMsg({ id: "a" }), makeMsg({ id: "b" })];
    useMessageStore.getState().setMessages(msgs);
    expect(useMessageStore.getState().messages).toHaveLength(2);
  });

  it("appendMessage adds to end", () => {
    useMessageStore.getState().setMessages([makeMsg({ id: "a" })]);
    useMessageStore.getState().appendMessage(makeMsg({ id: "b" }));
    expect(useMessageStore.getState().messages).toHaveLength(2);
    expect(useMessageStore.getState().messages[1].id).toBe("b");
  });

  it("updateMessage updates matching message", () => {
    useMessageStore.getState().setMessages([makeMsg({ id: "a", content: "old" })]);
    useMessageStore.getState().updateMessage("a", { content: "new" });
    expect(useMessageStore.getState().messages[0].content).toBe("new");
  });

  it("updateMessage leaves non-matching messages unchanged", () => {
    useMessageStore.getState().setMessages([makeMsg({ id: "a" }), makeMsg({ id: "b" })]);
    useMessageStore.getState().updateMessage("b", { content: "updated" });
    expect(useMessageStore.getState().messages[0].content).toBe("hello");
    expect(useMessageStore.getState().messages[1].content).toBe("updated");
  });

  it("clearMessages empties the array", () => {
    useMessageStore.getState().setMessages([makeMsg()]);
    useMessageStore.getState().clearMessages();
    expect(useMessageStore.getState().messages).toHaveLength(0);
  });

  it("copyMessage writes to clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    useMessageStore.getState().setMessages([makeMsg({ id: "x", content: "copy me" })]);
    useMessageStore.getState().copyMessage("x");
    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  it("copyMessage does nothing for non-existent id", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    useMessageStore.getState().copyMessage("nonexistent");
    expect(writeText).not.toHaveBeenCalled();
  });
});
