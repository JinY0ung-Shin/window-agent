import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeToolCalls } from "../toolService";
import type { ToolCall } from "../types";

vi.mock("../tauriCommands", () => ({
  executeTool: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const makeToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: "tc-1",
  name: "read_file",
  arguments: '{"path": "/tmp/test"}',
  ...overrides,
});

describe("executeToolCalls", () => {
  it("returns tool result messages on success", async () => {
    const { executeTool } = await import("../tauriCommands");
    vi.mocked(executeTool).mockResolvedValue({ status: "success", output: "file content" });

    const results = await executeToolCalls([makeToolCall()], "conv-1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("tool");
    expect(results[0].content).toBe("file content");
    expect(results[0].tool_call_id).toBe("tc-1");
  });

  it("prefixes 'Error:' for error status", async () => {
    const { executeTool } = await import("../tauriCommands");
    vi.mocked(executeTool).mockResolvedValue({ status: "error", output: "not found" });

    const results = await executeToolCalls([makeToolCall()], "conv-1");
    expect(results[0].content).toBe("Error: not found");
  });

  it("catches thrown errors and returns error message", async () => {
    const { executeTool } = await import("../tauriCommands");
    vi.mocked(executeTool).mockRejectedValue(new Error("network error"));

    const results = await executeToolCalls([makeToolCall()], "conv-1");
    expect(results[0].content).toBe("Error: network error");
  });

  it("processes multiple tool calls sequentially", async () => {
    const { executeTool } = await import("../tauriCommands");
    vi.mocked(executeTool)
      .mockResolvedValueOnce({ status: "success", output: "result-1" })
      .mockResolvedValueOnce({ status: "success", output: "result-2" });

    const calls = [makeToolCall({ id: "tc-1" }), makeToolCall({ id: "tc-2" })];
    const results = await executeToolCalls(calls, "conv-1");
    expect(results).toHaveLength(2);
    expect(results[0].tool_call_id).toBe("tc-1");
    expect(results[1].tool_call_id).toBe("tc-2");
  });

  it("passes correct arguments to executeTool", async () => {
    const { executeTool } = await import("../tauriCommands");
    vi.mocked(executeTool).mockResolvedValue({ status: "success", output: "ok" });

    await executeToolCalls([makeToolCall({ name: "write_file", arguments: '{"content":"hi"}' })], "conv-99");
    expect(executeTool).toHaveBeenCalledWith("write_file", '{"content":"hi"}', "conv-99");
  });
});
