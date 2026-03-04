import { describe, it, expect } from "vitest";
import { buildChatMessages } from "../chatHelpers";
import { DEFAULT_SYSTEM_PROMPT } from "../../constants";
import type { ChatMessage } from "../types";

describe("buildChatMessages", () => {
  it("prepends system prompt with default", () => {
    const result = buildChatMessages([]);
    expect(result).toEqual([{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]);
  });

  it("uses custom system prompt when provided", () => {
    const custom = "You are a pirate.";
    const result = buildChatMessages([], custom);
    expect(result[0]).toEqual({ role: "system", content: custom });
  });

  it("maps user/agent types to user/assistant roles", () => {
    const messages: ChatMessage[] = [
      { id: "1", type: "user", content: "hi" },
      { id: "2", type: "agent", content: "hello" },
    ];
    const result = buildChatMessages(messages);
    expect(result[1]).toEqual({ role: "user", content: "hi" });
    expect(result[2]).toEqual({ role: "assistant", content: "hello" });
  });

  it("filters out loading messages", () => {
    const messages: ChatMessage[] = [
      { id: "1", type: "user", content: "hi" },
      { id: "2", type: "agent", content: "loading...", isLoading: true },
    ];
    const result = buildChatMessages(messages);
    expect(result).toHaveLength(2); // system + 1 user
  });

  it("limits to last 10 messages", () => {
    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      type: "user" as const,
      content: `msg-${i}`,
    }));
    const result = buildChatMessages(messages);
    // system + 10 history
    expect(result).toHaveLength(11);
    expect(result[1].content).toBe("msg-5");
    expect(result[10].content).toBe("msg-14");
  });
});
