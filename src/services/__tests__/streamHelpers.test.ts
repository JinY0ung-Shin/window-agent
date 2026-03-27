import { describe, it, expect, beforeEach } from "vitest";
import {
  createPendingMessage,
  updateMessageInList,
  isWorkspacePath,
  classifyToolCalls,
} from "../streamHelpers";
import type { ChatMessage, ToolCall } from "../types";
import type { ToolDefinition } from "../toolRegistry";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("../tauriCommands");
vi.mock("../toolService");
vi.mock("../browserApprovalService", () => ({
  extractBrowserDomain: vi.fn().mockReturnValue(null),
  isBrowserDomainApproved: vi.fn().mockReturnValue(false),
  isCredentialBearingTool: vi.fn().mockReturnValue(false),
  clearBrowserApprovals: vi.fn(),
}));

describe("createPendingMessage", () => {
  it("returns object with msgId and msg", () => {
    const result = createPendingMessage();
    expect(result).toHaveProperty("msgId");
    expect(result).toHaveProperty("msg");
  });

  it("generates unique msgIds on successive calls", () => {
    const a = createPendingMessage();
    const b = createPendingMessage();
    expect(a.msgId).not.toBe(b.msgId);
  });

  it("msg has type=agent and status=pending", () => {
    const { msg } = createPendingMessage();
    expect(msg.type).toBe("agent");
    expect(msg.status).toBe("pending");
  });

  it("includes requestId when provided", () => {
    const { msg } = createPendingMessage("req-123");
    expect(msg.requestId).toBe("req-123");
  });

  it("requestId is undefined when not provided", () => {
    const { msg } = createPendingMessage();
    expect(msg.requestId).toBeUndefined();
  });

  it("msg.id matches the returned msgId", () => {
    const result = createPendingMessage();
    expect(result.msg.id).toBe(result.msgId);
  });
});

describe("updateMessageInList", () => {
  const baseMessages: ChatMessage[] = [
    { id: "m1", type: "user", content: "hello", status: "complete" },
    { id: "m2", type: "agent", content: "world", status: "pending" },
  ];

  it("updates matching message by id", () => {
    const updated = updateMessageInList(baseMessages, "m2", { content: "updated" });
    expect(updated[1].content).toBe("updated");
  });

  it("preserves non-matching messages", () => {
    const updated = updateMessageInList(baseMessages, "m2", { content: "updated" });
    expect(updated[0]).toEqual(baseMessages[0]);
  });

  it("returns same content when id not found", () => {
    const updated = updateMessageInList(baseMessages, "nonexistent", { content: "new" });
    expect(updated).toEqual(baseMessages);
  });

  it("can update multiple fields at once", () => {
    const updated = updateMessageInList(baseMessages, "m2", {
      content: "done",
      status: "complete",
    });
    expect(updated[1].content).toBe("done");
    expect(updated[1].status).toBe("complete");
  });
});

describe("isWorkspacePath", () => {
  const makeToolCall = (name: string, args: Record<string, unknown>): ToolCall => ({
    id: "tc-1",
    name,
    arguments: JSON.stringify(args),
  });

  it("returns false when workspacePath is undefined", () => {
    const tc = makeToolCall("write_file", { path: "/workspace/file.txt" });
    expect(isWorkspacePath(tc, undefined)).toBe(false);
  });

  it("returns false for non-write/delete tools", () => {
    const tc = makeToolCall("read_file", { path: "/workspace/file.txt" });
    expect(isWorkspacePath(tc, "/workspace")).toBe(false);
  });

  it("returns true for write_file within workspace", () => {
    const tc = makeToolCall("write_file", { path: "/workspace/src/file.ts" });
    expect(isWorkspacePath(tc, "/workspace")).toBe(true);
  });

  it("returns true for delete_file within workspace", () => {
    const tc = makeToolCall("delete_file", { path: "/workspace/old.txt" });
    expect(isWorkspacePath(tc, "/workspace")).toBe(true);
  });

  it("returns false for path with '..' (directory traversal)", () => {
    const tc = makeToolCall("write_file", { path: "/workspace/../etc/passwd" });
    expect(isWorkspacePath(tc, "/workspace")).toBe(false);
  });

  it("returns false for path outside workspace", () => {
    const tc = makeToolCall("write_file", { path: "/other/file.txt" });
    expect(isWorkspacePath(tc, "/workspace")).toBe(false);
  });

  it("returns false for invalid JSON arguments", () => {
    const tc: ToolCall = { id: "tc-1", name: "write_file", arguments: "not json" };
    expect(isWorkspacePath(tc, "/workspace")).toBe(false);
  });

  it("returns false when path arg is missing", () => {
    const tc = makeToolCall("write_file", { content: "data" });
    expect(isWorkspacePath(tc, "/workspace")).toBe(false);
  });
});

describe("classifyToolCalls", () => {
  const toolDefs: ToolDefinition[] = [
    { name: "read_file", description: "Read", tier: "auto", parameters: {} },
    { name: "write_file", description: "Write", tier: "confirm", parameters: {} },
    { name: "exec_cmd", description: "Exec", tier: "deny", parameters: {} },
  ];

  const makeTc = (name: string): ToolCall => ({
    id: `tc-${name}`,
    name,
    arguments: "{}",
  });

  it("classifies auto-tier tools into autoTools", () => {
    const result = classifyToolCalls([makeTc("read_file")], toolDefs);
    expect(result.autoTools).toHaveLength(1);
    expect(result.autoTools[0].name).toBe("read_file");
    expect(result.confirmTools).toHaveLength(0);
    expect(result.denyTools).toHaveLength(0);
  });

  it("classifies deny-tier tools into denyTools", () => {
    const result = classifyToolCalls([makeTc("exec_cmd")], toolDefs);
    expect(result.denyTools).toHaveLength(1);
    expect(result.denyTools[0].name).toBe("exec_cmd");
  });

  it("classifies confirm-tier tools into confirmTools by default", () => {
    const result = classifyToolCalls([makeTc("write_file")], toolDefs);
    expect(result.confirmTools).toHaveLength(1);
    expect(result.confirmTools[0].name).toBe("write_file");
  });

  it("unknown tools default to confirm tier", () => {
    const result = classifyToolCalls([makeTc("unknown_tool")], toolDefs);
    expect(result.confirmTools).toHaveLength(1);
  });

  it("classifies multiple tools across categories", () => {
    const tcs = [makeTc("read_file"), makeTc("write_file"), makeTc("exec_cmd")];
    const result = classifyToolCalls(tcs, toolDefs);
    expect(result.autoTools).toHaveLength(1);
    expect(result.confirmTools).toHaveLength(1);
    expect(result.denyTools).toHaveLength(1);
  });
});
