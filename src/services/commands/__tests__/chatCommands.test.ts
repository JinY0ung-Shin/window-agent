import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createConversation,
  getConversations,
  createTeamConversation,
  getConversationDetail,
  updateConversationSummary,
  deleteConversation,
  setLearningMode,
  getMessages,
  saveMessage,
  deleteMessagesAndMaybeResetSummary,
  listToolCallLogs,
  executeTool,
  readConsolidatedMemory,
  listPendingConsolidations,
  readDigest,
  writeDigest,
  writeConsolidatedMemory,
  updateConversationDigest,
  updateConversationConsolidated,
  archiveConversationNotes,
  abortTeamRun,
} from "../chatCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("chatCommands", () => {
  // ── Conversation CRUD ──

  it("createConversation calls invoke with correct args", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "1", title: "Test", agent_id: "a1" });
    await createConversation("a1", "Test");
    expect(invoke).toHaveBeenCalledWith("create_conversation", { title: "Test", agentId: "a1" });
  });

  it("createConversation passes null when no title", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "1", title: null, agent_id: "a1" });
    await createConversation("a1");
    expect(invoke).toHaveBeenCalledWith("create_conversation", { title: null, agentId: "a1" });
  });

  it("getConversations calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await getConversations();
    expect(invoke).toHaveBeenCalledWith("get_conversations");
  });

  it("createTeamConversation calls invoke with correct args", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "c1", title: "Team Chat" });
    await createTeamConversation("t1", "a1", "Team Chat");
    expect(invoke).toHaveBeenCalledWith("create_team_conversation", {
      teamId: "t1",
      leaderAgentId: "a1",
      title: "Team Chat",
    });
  });

  it("createTeamConversation passes null when no title", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "c1", title: null });
    await createTeamConversation("t1", "a1");
    expect(invoke).toHaveBeenCalledWith("create_team_conversation", {
      teamId: "t1",
      leaderAgentId: "a1",
      title: null,
    });
  });

  it("getConversationDetail passes id", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "c1", messages: [] });
    await getConversationDetail("c1");
    expect(invoke).toHaveBeenCalledWith("get_conversation_detail", { id: "c1" });
  });

  it("updateConversationSummary passes all args", async () => {
    vi.mocked(invoke).mockResolvedValue(1);
    await updateConversationSummary("c1", "summary text", "m5", "prev_summary");
    expect(invoke).toHaveBeenCalledWith("update_conversation_summary", {
      id: "c1",
      summary: "summary text",
      upToMessageId: "m5",
      expectedPrevious: "prev_summary",
    });
  });

  it("updateConversationSummary accepts null expectedPrevious", async () => {
    vi.mocked(invoke).mockResolvedValue(1);
    await updateConversationSummary("c1", "summary", "m5", null);
    expect(invoke).toHaveBeenCalledWith("update_conversation_summary", {
      id: "c1",
      summary: "summary",
      upToMessageId: "m5",
      expectedPrevious: null,
    });
  });

  it("deleteConversation passes conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await deleteConversation("c1");
    expect(invoke).toHaveBeenCalledWith("delete_conversation", { conversationId: "c1" });
  });

  // ── Learning Mode ──

  it("setLearningMode passes id and enabled", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await setLearningMode("c1", true);
    expect(invoke).toHaveBeenCalledWith("set_learning_mode", { id: "c1", enabled: true });
  });

  // ── Message CRUD ──

  it("getMessages passes conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await getMessages("c1");
    expect(invoke).toHaveBeenCalledWith("get_messages", { conversationId: "c1" });
  });

  it("saveMessage passes request object", async () => {
    const req = { conversation_id: "c1", role: "user" as const, content: "hello" };
    vi.mocked(invoke).mockResolvedValue({ id: "m1", ...req, created_at: "" });
    await saveMessage(req);
    expect(invoke).toHaveBeenCalledWith("save_message", { request: req });
  });

  it("deleteMessagesAndMaybeResetSummary passes conversationId and messageId", async () => {
    vi.mocked(invoke).mockResolvedValue({ summary_was_reset: true });
    const result = await deleteMessagesAndMaybeResetSummary("c1", "m3");
    expect(invoke).toHaveBeenCalledWith("delete_messages_and_maybe_reset_summary", {
      conversationId: "c1",
      messageId: "m3",
    });
    expect(result).toEqual({ summary_was_reset: true });
  });

  // ── Tool Call Logs ──

  it("listToolCallLogs passes conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await listToolCallLogs("c1");
    expect(invoke).toHaveBeenCalledWith("list_tool_call_logs", { conversationId: "c1" });
  });

  // ── Tool Execution ──

  it("executeTool passes toolName, toolInput, conversationId", async () => {
    const result = { tool_call_log_id: "t1", status: "ok", output: "done", duration_ms: 100 };
    vi.mocked(invoke).mockResolvedValue(result);
    const res = await executeTool("read_file", '{"path":"/tmp"}', "c1");
    expect(invoke).toHaveBeenCalledWith("execute_tool", {
      toolName: "read_file",
      toolInput: '{"path":"/tmp"}',
      conversationId: "c1",
    });
    expect(res).toEqual(result);
  });

  // ── System Memory (Consolidation) ──

  it("readConsolidatedMemory passes agentId", async () => {
    vi.mocked(invoke).mockResolvedValue("memory content");
    const result = await readConsolidatedMemory("a1");
    expect(invoke).toHaveBeenCalledWith("read_consolidated_memory", { agentId: "a1" });
    expect(result).toBe("memory content");
  });

  it("listPendingConsolidations calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await listPendingConsolidations();
    expect(invoke).toHaveBeenCalledWith("list_pending_consolidations");
  });

  it("readDigest passes agentId and conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue("digest content");
    await readDigest("a1", "c1");
    expect(invoke).toHaveBeenCalledWith("read_digest", { agentId: "a1", conversationId: "c1" });
  });

  it("writeDigest passes agentId, conversationId, content", async () => {
    vi.mocked(invoke).mockResolvedValue("digest-id-1");
    const result = await writeDigest("a1", "c1", "digest text");
    expect(invoke).toHaveBeenCalledWith("write_digest", {
      agentId: "a1",
      conversationId: "c1",
      content: "digest text",
    });
    expect(result).toBe("digest-id-1");
  });

  it("writeConsolidatedMemory passes agentId, content, version", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeConsolidatedMemory("a1", "consolidated text", 3);
    expect(invoke).toHaveBeenCalledWith("write_consolidated_memory", {
      agentId: "a1",
      content: "consolidated text",
      version: 3,
    });
  });

  it("updateConversationDigest passes conversationId and digestId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await updateConversationDigest("c1", "d1");
    expect(invoke).toHaveBeenCalledWith("update_conversation_digest", {
      conversationId: "c1",
      digestId: "d1",
    });
  });

  it("updateConversationDigest accepts null digestId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await updateConversationDigest("c1", null);
    expect(invoke).toHaveBeenCalledWith("update_conversation_digest", {
      conversationId: "c1",
      digestId: null,
    });
  });

  it("updateConversationConsolidated passes conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await updateConversationConsolidated("c1");
    expect(invoke).toHaveBeenCalledWith("update_conversation_consolidated", {
      conversationId: "c1",
    });
  });

  it("archiveConversationNotes passes conversationId and agentId", async () => {
    vi.mocked(invoke).mockResolvedValue(5);
    const result = await archiveConversationNotes("c1", "a1");
    expect(invoke).toHaveBeenCalledWith("archive_conversation_notes", {
      conversationId: "c1",
      agentId: "a1",
    });
    expect(result).toBe(5);
  });

  // ── Team Run ──

  it("abortTeamRun passes runId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await abortTeamRun("r1");
    expect(invoke).toHaveBeenCalledWith("abort_team_run", { runId: "r1" });
  });
});
