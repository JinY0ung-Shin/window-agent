import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createConversation,
  getConversations,
  getMessages,
  saveMessage,
  deleteConversation,
} from "../tauriCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("tauriCommands", () => {
  it("createConversation calls invoke with correct args", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "1", title: "Test", created_at: "", updated_at: "" });
    await createConversation("Test");
    expect(invoke).toHaveBeenCalledWith("create_conversation", { title: "Test" });
  });

  it("createConversation passes null when no title", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "1", title: "새 대화", created_at: "", updated_at: "" });
    await createConversation();
    expect(invoke).toHaveBeenCalledWith("create_conversation", { title: null });
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
});
