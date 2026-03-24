import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDebugStore } from "../debugStore";
import type { ToolCallLog } from "../../services/types";

vi.mock("../../services/tauriCommands", () => ({
  listToolCallLogs: vi.fn().mockResolvedValue([]),
}));

const makeLog = (overrides: Partial<ToolCallLog> = {}): ToolCallLog => ({
  id: "log-1",
  conversation_id: "conv-1",
  message_id: null,
  tool_name: "read_file",
  tool_input: "{}",
  tool_output: "ok",
  status: "success",
  duration_ms: 100,
  artifact_id: null,
  created_at: "2026-01-01",
  ...overrides,
});

const initial = useDebugStore.getState();

beforeEach(() => {
  useDebugStore.setState(initial, true);
  vi.clearAllMocks();
});

describe("debugStore", () => {
  it("loadLogs fetches and sets logs", async () => {
    const { listToolCallLogs } = await import("../../services/tauriCommands");
    const logs = [makeLog()];
    vi.mocked(listToolCallLogs).mockResolvedValue(logs);
    await useDebugStore.getState().loadLogs("conv-1");
    expect(useDebugStore.getState().logs).toEqual(logs);
  });

  it("loadLogs sets empty on error", async () => {
    const { listToolCallLogs } = await import("../../services/tauriCommands");
    vi.mocked(listToolCallLogs).mockRejectedValue(new Error("fail"));
    await useDebugStore.getState().loadLogs("conv-1");
    expect(useDebugStore.getState().logs).toEqual([]);
  });

  it("addLog appends log", () => {
    useDebugStore.getState().addLog(makeLog({ id: "a" }));
    useDebugStore.getState().addLog(makeLog({ id: "b" }));
    expect(useDebugStore.getState().logs).toHaveLength(2);
  });

  it("updateLog updates matching log", () => {
    useDebugStore.getState().addLog(makeLog({ id: "a", status: "pending" }));
    useDebugStore.getState().updateLog("a", { status: "success" });
    expect(useDebugStore.getState().logs[0].status).toBe("success");
  });

  it("addHttpLog appends http log", () => {
    useDebugStore.getState().addHttpLog({
      id: "h1", timestamp: "t", method: "GET", url: "/api",
      status: 200, duration_ms: 50, request_headers: "", response_headers: "",
      response_body_preview: "", error: null,
    });
    expect(useDebugStore.getState().httpLogs).toHaveLength(1);
  });

  it("clearHttpLogs empties httpLogs", () => {
    useDebugStore.getState().addHttpLog({
      id: "h1", timestamp: "t", method: "GET", url: "/api",
      status: 200, duration_ms: 50, request_headers: "", response_headers: "",
      response_body_preview: "", error: null,
    });
    useDebugStore.getState().clearHttpLogs();
    expect(useDebugStore.getState().httpLogs).toHaveLength(0);
  });

  it("setActiveTab updates tab", () => {
    useDebugStore.getState().setActiveTab("http");
    expect(useDebugStore.getState().activeTab).toBe("http");
  });

  it("setOpen updates isOpen", () => {
    useDebugStore.getState().setOpen(true);
    expect(useDebugStore.getState().isOpen).toBe(true);
  });

  it("getFilteredLogs filters by tool name", () => {
    useDebugStore.getState().addLog(makeLog({ id: "a", tool_name: "read_file" }));
    useDebugStore.getState().addLog(makeLog({ id: "b", tool_name: "write_file" }));
    useDebugStore.getState().setFilterByTool("read_file");
    expect(useDebugStore.getState().getFilteredLogs()).toHaveLength(1);
  });

  it("getFilteredLogs filters by status", () => {
    useDebugStore.getState().addLog(makeLog({ id: "a", status: "success" }));
    useDebugStore.getState().addLog(makeLog({ id: "b", status: "error" }));
    useDebugStore.getState().setFilterByStatus(["error"]);
    expect(useDebugStore.getState().getFilteredLogs()).toHaveLength(1);
    expect(useDebugStore.getState().getFilteredLogs()[0].id).toBe("b");
  });

  it("clear empties logs", () => {
    useDebugStore.getState().addLog(makeLog());
    useDebugStore.getState().clear();
    expect(useDebugStore.getState().logs).toHaveLength(0);
  });
});
