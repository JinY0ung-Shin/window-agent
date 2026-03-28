import { describe, it, expect } from "vitest";
import { buildChatMessages, buildConversationContext } from "../chatHelpers";
import type { ChatMessage } from "../types";

function makeMsg(
  id: string,
  content: string,
  type: "user" | "agent" = "user",
  status: "complete" | "pending" = "complete",
): ChatMessage {
  return { id, type, content, status };
}

describe("buildChatMessages (legacy – no systemPromptTokens)", () => {
  it("returns empty array for no messages", () => {
    const result = buildChatMessages([]);
    expect(result).toEqual([]);
  });

  it("maps user/agent types to user/assistant roles", () => {
    const messages: ChatMessage[] = [
      makeMsg("1", "hi", "user"),
      makeMsg("2", "hello", "agent"),
    ];
    const result = buildChatMessages(messages);
    expect(result[0]).toEqual({ role: "user", content: "hi" });
    expect(result[1]).toEqual({ role: "assistant", content: "hello" });
  });

  it("filters out pending messages", () => {
    const messages: ChatMessage[] = [
      makeMsg("1", "hi", "user"),
      makeMsg("2", "loading...", "agent", "pending"),
    ];
    const result = buildChatMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("limits to last 10 messages", () => {
    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) =>
      makeMsg(String(i), `msg-${i}`),
    );
    const result = buildChatMessages(messages);
    expect(result).toHaveLength(10);
    expect(result[0].content).toBe("msg-5");
    expect(result[9].content).toBe("msg-14");
  });
});

describe("buildChatMessages (token-based)", () => {
  // Tests use MAX_CONTEXT_TOKENS (1000000) as the total budget.
  // systemPromptTokens is set close to the budget to test truncation behavior.

  it("selects messages within token budget", () => {
    // systemPromptTokens = 999900, budget = 1000000 - 999900 = 100
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeMsg(String(i), `msg`),
    );
    const result = buildChatMessages(messages, 999900);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("prefers latest messages when budget is limited", () => {
    // budget = 1000000 - 999980 = 20 tokens
    // "hi" = ceil(2*0.25)=1, +4 overhead = 5 tokens per msg → 4 msgs fit
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMsg(String(i), `hi`),
    );
    const result = buildChatMessages(messages, 999980);
    expect(result.length).toBe(4);
    expect(result[0].content).toBe("hi");
    expect(result.length).toBe(4);
  });

  it("subtracts summaryTokens from budget", () => {
    // budget = 1000000 - 999980 - 10 = 10 tokens
    // "hi" = 5 tokens per msg → 2 msgs fit
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMsg(String(i), `hi`),
    );
    const result = buildChatMessages(messages, 999980, 10);
    expect(result.length).toBe(2);
  });

  it("guarantees at least 1 message even when budget is exhausted", () => {
    // budget = 1000000 - 1000000 = 0 → safety kicks in
    const messages = [makeMsg("1", "안녕하세요 이것은 긴 메시지입니다")];
    const result = buildChatMessages(messages, 1000000);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("안녕하세요 이것은 긴 메시지입니다");
  });

  it("returns empty array when no messages exist", () => {
    const result = buildChatMessages([], 100);
    expect(result).toEqual([]);
  });

  it("handles Korean messages with correct token estimation", () => {
    // "안녕" = 2 Korean chars * 1.5 = 3 → ceil = 3, + 4 overhead = 7 tokens per msg
    // budget = 1000000 - 999980 = 20 → 20/7 = 2 msgs fit
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMsg(String(i), "안녕"),
    );
    const result = buildChatMessages(messages, 999980);
    expect(result.length).toBe(2);
  });
});

describe("buildConversationContext", () => {
  it("returns base system prompt when no summary", async () => {
    const messages = [makeMsg("1", "hello", "user")];
    const result = await buildConversationContext({
      messages,
      summary: null,
      baseSystemPrompt: "You are helpful.",
    });
    expect(result.systemPrompt).toBe("You are helpful.");
    expect(result.apiMessages.length).toBe(1);
  });

  it("includes summary section in system prompt when summary exists", async () => {
    const messages = [makeMsg("1", "hello", "user")];
    const result = await buildConversationContext({
      messages,
      summary: "이전에 날씨에 대해 이야기했습니다.",
      baseSystemPrompt: "You are helpful.",
    });
    expect(result.systemPrompt).toContain("[이전 대화 요약]");
    expect(result.systemPrompt).toContain("이전에 날씨에 대해 이야기했습니다.");
    expect(result.systemPrompt).toContain("[최근 대화는 아래에 이어집니다]");
    expect(result.systemPrompt.startsWith("You are helpful.")).toBe(true);
  });

  it("adjusts token budget based on actual system prompt size", async () => {
    // Verify that a larger system prompt (with summary) reduces the number of
    // messages that fit. Use a huge base prompt to leave very little budget.
    // Budget without summary: 1000000 - 999000 = 1000 tokens → ~45 msgs
    // Budget with summary (~500 tokens): 1000000 - 999000 - 500 = 500 → ~22 msgs
    const hugeBasePrompt = "x".repeat(3996000); // ~999000 tokens
    const messages = Array.from({ length: 200 }, (_, i) =>
      makeMsg(String(i), "안녕하세요 반갑습니다 오늘 날씨가 좋습니다"),
    );
    const withSummary = await buildConversationContext({
      messages,
      summary: "요약입니다 ".repeat(50), // ~462 tokens
      baseSystemPrompt: hugeBasePrompt,
    });
    const withoutSummary = await buildConversationContext({
      messages,
      summary: null,
      baseSystemPrompt: hugeBasePrompt,
    });
    // With a summary, fewer messages should fit
    expect(withSummary.apiMessages.length).toBeLessThan(withoutSummary.apiMessages.length);
  });
});
