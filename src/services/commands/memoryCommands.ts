import { invoke } from "@tauri-apps/api/core";
import type { MemoryNote } from "../types";

export async function createMemoryNote(agentId: string, title: string, content: string): Promise<MemoryNote> {
  return invoke("create_memory_note", { agentId, title, content });
}

export async function listMemoryNotes(agentId: string): Promise<MemoryNote[]> {
  return invoke("list_memory_notes", { agentId });
}

export async function updateMemoryNote(id: string, title?: string | null, content?: string | null): Promise<MemoryNote> {
  return invoke("update_memory_note", { id, title: title ?? null, content: content ?? null });
}

export async function deleteMemoryNote(id: string): Promise<void> {
  return invoke("delete_memory_note", { id });
}
