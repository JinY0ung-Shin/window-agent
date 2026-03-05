import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createConversation,
  getConversations,
  getMessages,
  saveMessage,
  deleteConversation,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  writeAgentFile,
  readAgentFile,
  syncAgentsFromFs,
  seedManagerAgent,
  resizeAvatar,
  getBootstrapPrompt,
} from "../tauriCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("tauriCommands", () => {
  it("createConversation calls invoke with correct args", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "1", title: "Test", agent_id: "a1", created_at: "", updated_at: "" });
    await createConversation("a1", "Test");
    expect(invoke).toHaveBeenCalledWith("create_conversation", { title: "Test", agentId: "a1" });
  });

  it("createConversation passes null when no title", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "1", title: "새 대화", agent_id: "a1", created_at: "", updated_at: "" });
    await createConversation("a1");
    expect(invoke).toHaveBeenCalledWith("create_conversation", { title: null, agentId: "a1" });
  });

  it("getConversations calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await getConversations();
    expect(invoke).toHaveBeenCalledWith("get_conversations");
  });

  it("getMessages passes conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await getMessages("abc");
    expect(invoke).toHaveBeenCalledWith("get_messages", { conversationId: "abc" });
  });

  it("saveMessage passes request object", async () => {
    const req = { conversation_id: "x", role: "user" as const, content: "hi" };
    vi.mocked(invoke).mockResolvedValue({ id: "m1", ...req, created_at: "" });
    await saveMessage(req);
    expect(invoke).toHaveBeenCalledWith("save_message", { request: req });
  });

  it("deleteConversation passes conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await deleteConversation("abc");
    expect(invoke).toHaveBeenCalledWith("delete_conversation", { conversationId: "abc" });
  });

  // ── Agent commands ──

  it("listAgents calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const result = await listAgents();
    expect(invoke).toHaveBeenCalledWith("list_agents");
    expect(result).toEqual([]);
  });

  it("getAgent passes id", async () => {
    const agent = { id: "a1", folder_name: "test", name: "Test" };
    vi.mocked(invoke).mockResolvedValue(agent);
    const result = await getAgent("a1");
    expect(invoke).toHaveBeenCalledWith("get_agent", { id: "a1" });
    expect(result).toEqual(agent);
  });

  it("createAgent passes request object", async () => {
    const req = { folder_name: "new", name: "New Agent" };
    const agent = { id: "a2", ...req };
    vi.mocked(invoke).mockResolvedValue(agent);
    const result = await createAgent(req as any);
    expect(invoke).toHaveBeenCalledWith("create_agent", { request: req });
    expect(result).toEqual(agent);
  });

  it("updateAgent passes id and request", async () => {
    const req = { name: "Updated" };
    const agent = { id: "a1", name: "Updated" };
    vi.mocked(invoke).mockResolvedValue(agent);
    const result = await updateAgent("a1", req as any);
    expect(invoke).toHaveBeenCalledWith("update_agent", { id: "a1", request: req });
    expect(result).toEqual(agent);
  });

  it("deleteAgent passes id", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await deleteAgent("a1");
    expect(invoke).toHaveBeenCalledWith("delete_agent", { id: "a1" });
  });

  it("writeAgentFile passes folderName, fileName, content", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeAgentFile("my-agent", "IDENTITY.md", "# Hello");
    expect(invoke).toHaveBeenCalledWith("write_agent_file", {
      folderName: "my-agent",
      fileName: "IDENTITY.md",
      content: "# Hello",
    });
  });

  it("readAgentFile passes folderName, fileName", async () => {
    vi.mocked(invoke).mockResolvedValue("# Content");
    const result = await readAgentFile("my-agent", "SOUL.md");
    expect(invoke).toHaveBeenCalledWith("read_agent_file", {
      folderName: "my-agent",
      fileName: "SOUL.md",
    });
    expect(result).toBe("# Content");
  });

  it("syncAgentsFromFs calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const result = await syncAgentsFromFs();
    expect(invoke).toHaveBeenCalledWith("sync_agents_from_fs");
    expect(result).toEqual([]);
  });

  it("seedManagerAgent calls invoke with no extra args", async () => {
    const agent = { id: "m1", name: "매니저" };
    vi.mocked(invoke).mockResolvedValue(agent);
    const result = await seedManagerAgent();
    expect(invoke).toHaveBeenCalledWith("seed_manager_agent");
    expect(result).toEqual(agent);
  });

  it("resizeAvatar passes imageBase64", async () => {
    vi.mocked(invoke).mockResolvedValue("resized_base64");
    const result = await resizeAvatar("original_base64");
    expect(invoke).toHaveBeenCalledWith("resize_avatar", { imageBase64: "original_base64" });
    expect(result).toBe("resized_base64");
  });

  it("getBootstrapPrompt calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue("bootstrap content");
    const result = await getBootstrapPrompt();
    expect(invoke).toHaveBeenCalledWith("get_bootstrap_prompt");
    expect(result).toBe("bootstrap content");
  });
});
