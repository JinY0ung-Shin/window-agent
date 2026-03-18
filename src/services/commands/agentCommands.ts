import { invoke } from "@tauri-apps/api/core";
import type {
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
} from "../types";

// ── Agent CRUD ──

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

// ── Agent file I/O ──

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

export async function seedManagerAgent(locale: string): Promise<Agent> {
  return invoke("seed_manager_agent", { locale });
}

export async function refreshDefaultManagerPersona(locale: string): Promise<void> {
  return invoke("refresh_default_manager_persona", { locale });
}

export async function resizeAvatar(imageBase64: string): Promise<string> {
  return invoke("resize_avatar", { imageBase64 });
}

export async function getBootstrapPrompt(locale: string): Promise<string> {
  return invoke("get_bootstrap_prompt", { locale });
}

// ── Export / Import ──

export interface ImportResult {
  agents_imported: number;
  conversations_imported: number;
  messages_imported: number;
  warnings: string[];
}

export async function exportAgent(
  agentId: string,
  includeConversations: boolean,
): Promise<number[]> {
  return invoke("export_agent", { agentId, includeConversations });
}

export async function importAgent(zipBytes: number[]): Promise<ImportResult> {
  return invoke("import_agent", { zipBytes });
}
