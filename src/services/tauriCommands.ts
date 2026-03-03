import { invoke } from "@tauri-apps/api/core";
import type { Conversation, DbMessage, SaveMessageRequest } from "./types";

export async function createConversation(title?: string): Promise<Conversation> {
  return invoke("create_conversation", { title: title ?? null });
}

export async function getConversations(): Promise<Conversation[]> {
  return invoke("get_conversations");
}

export async function getMessages(conversationId: string): Promise<DbMessage[]> {
  return invoke("get_messages", { conversationId });
}

export async function saveMessage(request: SaveMessageRequest): Promise<DbMessage> {
  return invoke("save_message", { request });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  return invoke("delete_conversation", { conversationId });
}
