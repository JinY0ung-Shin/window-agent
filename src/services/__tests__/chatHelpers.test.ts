import { describe, it, expect } from "vitest";
import { buildChatMessages } from "../chatHelpers";
import type { ChatMessage } from "../types";

describe("buildChatMessages", () => {
  it("returns empty array for no messages", () => {
    const result = buildChatMessages([]);
    expect(result).toEqual([]);
  });

  it("maps user/agent types to user/assistant roles", () => {
    const messages: ChatMessage[] = [
      { id: "1", type: "user", content: "hi" },
      { id: "2", type: "agent", content: "hello" },
    ];
    const result = buildChatMessages(messages);
    expect(result[0]).toEqual({ role: "user", content: "hi" });
    expect(result[1]).toEqual({ role: "assistant", content: "hello" });
  });

  it("filters out loading messages", () => {
    const messages: ChatMessage[] = [
      { id: "1", type: "user", content: "hi" },
      { id: "2", type: "agent", content: "loading...", isLoading: true },
    ];
    const result = buildChatMessages(messages);
    expect(result).toHaveLength(1); // 1 user only
  });

  it("limits to last 10 messages", () => {
    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      type: "user" as const,
      content: `msg-${i}`,
    }));
    const result = buildChatMessages(messages);
    expect(result).toHaveLength(10);
    expect(result[0].content).toBe("msg-5");
    expect(result[9].content).toBe("msg-14");
  });
});
