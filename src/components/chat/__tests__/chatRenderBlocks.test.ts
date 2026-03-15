import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCall } from "../../../services/types";
import { buildChatRenderBlocks } from "../chatRenderBlocks";

function createToolCall(id: string, name: string, argumentsValue = "{}"): ToolCall {
  return { id, name, arguments: argumentsValue };
}

function createAgentMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "agent-1",
    type: "agent",
    content: "",
    status: "complete",
    ...overrides,
  };
}

function createToolMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "tool-1",
    type: "tool",
    content: "ok",
    status: "complete",
    tool_call_id: "call-1",
    tool_name: "http_request",
    ...overrides,
  };
}

describe("buildChatRenderBlocks", () => {
  it("groups assistant tool calls with their matching tool results", () => {
    const messages: ChatMessage[] = [
      createAgentMessage({
        id: "assistant-tool-call",
        content: "찾아볼게요",
        tool_calls: [
          createToolCall("call-1", "http_request", "{\"url\":\"https://example.com\"}"),
          createToolCall("call-2", "browser_click", "{\"ref\":39}"),
        ],
      }),
      createToolMessage({
        id: "tool-result-1",
        tool_call_id: "call-1",
        tool_name: "http_request",
        content: "GET https://example.com",
      }),
      createToolMessage({
        id: "tool-result-2",
        tool_call_id: "call-2",
        tool_name: "browser_click",
        content: "clicked",
      }),
      createAgentMessage({ id: "assistant-final", content: "완료했습니다." }),
    ];

    const blocks = buildChatRenderBlocks(messages, "idle", []);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("tool_run");
    if (blocks[0].type !== "tool_run") throw new Error("Expected tool_run");
    expect(blocks[0].leadingContent).toBe("찾아볼게요");
    expect(blocks[0].steps).toHaveLength(2);
    expect(blocks[0].steps[0].resultMessage?.id).toBe("tool-result-1");
    expect(blocks[0].steps[1].resultMessage?.id).toBe("tool-result-2");
    expect(blocks[0].steps.every((step) => step.status === "executed")).toBe(true);
    expect(blocks[1]).toMatchObject({
      type: "message",
      message: { id: "assistant-final", content: "완료했습니다." },
    });
  });

  it("keeps unmatched tool results as orphan fallback blocks in order", () => {
    const messages: ChatMessage[] = [
      createAgentMessage({
        id: "assistant-tool-call",
        tool_calls: [createToolCall("call-1", "http_request")],
      }),
      createToolMessage({
        id: "tool-orphan",
        tool_call_id: "unknown",
        tool_name: "shell",
        content: "orphan",
      }),
      createToolMessage({
        id: "tool-result-1",
        tool_call_id: "call-1",
        tool_name: "http_request",
        content: "ok",
      }),
    ];

    const blocks = buildChatRenderBlocks(messages, "idle", []);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("tool_run");
    expect(blocks[1]).toMatchObject({
      type: "orphan_tool_result",
      message: { id: "tool-orphan", content: "orphan" },
    });
  });

  it("marks the latest live run and derives pending or running statuses", () => {
    const messages: ChatMessage[] = [
      createAgentMessage({
        id: "assistant-old",
        tool_calls: [createToolCall("call-old", "http_request")],
      }),
      createToolMessage({
        id: "tool-old",
        tool_call_id: "call-old",
        content: "old result",
      }),
      createAgentMessage({
        id: "assistant-live",
        tool_calls: [
          createToolCall("call-pending", "http_request"),
          createToolCall("call-running", "browser_click"),
        ],
      }),
    ];

    const pendingToolCalls = [createToolCall("call-pending", "http_request")];
    const pendingBlocks = buildChatRenderBlocks(messages, "tool_waiting", pendingToolCalls);
    const runningBlocks = buildChatRenderBlocks(messages, "tool_running", pendingToolCalls);

    expect(pendingBlocks[0].type).toBe("tool_run");
    expect(pendingBlocks[1].type).toBe("tool_run");
    if (pendingBlocks[1].type !== "tool_run" || runningBlocks[1].type !== "tool_run") {
      throw new Error("Expected latest block to be tool_run");
    }

    expect(pendingBlocks[1].isActiveRun).toBe(true);
    expect(pendingBlocks[1].steps.map((step) => step.status)).toEqual(["pending", "incomplete"]);
    expect(runningBlocks[1].steps.map((step) => step.status)).toEqual(["running", "running"]);
  });
});
