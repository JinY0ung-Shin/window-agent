import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  DbMessage,
  SaveMessageRequest,
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
} from "./types";

// ── Chat commands ──

export async function createConversation(
  agentId: string,
  title?: string,
): Promise<Conversation> {
  return invoke("create_conversation", { title: title ?? null, agentId });
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

// ── Agent commands ──

export async function listAgents(): Promise<Agent[]> {
  return invoke("list_agents");
}

export async function getAgent(id: string): Promise<Agent> {
  return invoke("get_agent", { id });
}

export async function createAgent(request: CreateAgentRequest): Promise<Agent> {
  return invoke("create_agent", { request });
}

export async function updateAgent(
  id: string,
  request: UpdateAgentRequest,
): Promise<Agent> {
  return invoke("update_agent", { id, request });
}

export async function deleteAgent(id: string): Promise<void> {
  return invoke("delete_agent", { id });
}

// ── Agent file commands (folder_name + file_name) ──

export async function writeAgentFile(
  folderName: string,
  fileName: string,
  content: string,
): Promise<void> {
  return invoke("write_agent_file", { folderName, fileName, content });
}

export async function readAgentFile(
  folderName: string,
  fileName: string,
): Promise<string> {
  return invoke("read_agent_file", { folderName, fileName });
}

// ── Sync / Seed / Avatar ──

export async function syncAgentsFromFs(): Promise<Agent[]> {
  return invoke("sync_agents_from_fs");
}

export async function seedManagerAgent(): Promise<Agent> {
  return invoke("seed_manager_agent");
}

export async function resizeAvatar(imageBase64: string): Promise<string> {
  return invoke("resize_avatar", { imageBase64 });
}

export async function getBootstrapPrompt(): Promise<string> {
  return invoke("get_bootstrap_prompt");
}
