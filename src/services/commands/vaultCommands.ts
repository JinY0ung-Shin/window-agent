import { invoke } from "@tauri-apps/api/core";
import type {
  VaultNote,
  VaultNoteSummary,
  GraphData,
  SearchResult,
  LinkRef,
  CreateNoteParams,
  NoteUpdates,
  IndexStats,
} from "../vaultTypes";

// ── CRUD ─────────────────────────────────────────────

export async function vaultCreateNote(params: CreateNoteParams): Promise<VaultNote> {
  return invoke("vault_create_note", {
    agentId: params.agentId,
    scope: params.scope ?? "agent",
    category: params.category,
    title: params.title,
    content: params.content,
    tags: params.tags ?? [],
    relatedIds: params.relatedIds ?? [],
  });
}

export async function vaultReadNote(noteId: string): Promise<VaultNote> {
  return invoke("vault_read_note", { noteId });
}

export async function vaultUpdateNote(
  noteId: string,
  callerAgentId: string,
  updates: NoteUpdates,
): Promise<VaultNote> {
  return invoke("vault_update_note", {
    noteId,
    callerAgentId,
    title: updates.title ?? null,
    content: updates.content ?? null,
    tags: updates.tags ?? null,
    confidence: updates.confidence ?? null,
    addLinks: updates.addLinks ?? null,
  });
}

export async function vaultDeleteNote(noteId: string, caller: string = "user"): Promise<void> {
  return invoke("vault_delete_note", { noteId, caller });
}

// ── Query ────────────────────────────────────────────

export async function vaultListNotes(agentId?: string | null): Promise<VaultNoteSummary[]> {
  return invoke("vault_list_notes", { agentId: agentId ?? null });
}

export async function vaultSearch(
  query: string,
  scope?: "self" | "shared" | "all" | null,
  agentId?: string | null,
): Promise<SearchResult[]> {
  return invoke("vault_search", { query, scope: scope ?? "all", agentId: agentId ?? null });
}

export async function vaultGetGraph(
  agentId?: string | null,
  depth?: number | null,
  includeShared: boolean = true,
): Promise<GraphData> {
  return invoke("vault_get_graph", {
    agentId: agentId ?? null,
    depth: depth ?? null,
    includeShared,
  });
}

export async function vaultGetBacklinks(noteId: string): Promise<LinkRef[]> {
  return invoke("vault_get_backlinks", { noteId });
}

// ── Vault operations ─────────────────────────────────

export async function vaultGetPath(): Promise<string> {
  return invoke("vault_get_path");
}

export async function vaultOpenInObsidian(): Promise<void> {
  return invoke("vault_open_in_obsidian");
}

export async function vaultRebuildIndex(): Promise<IndexStats> {
  return invoke("vault_rebuild_index");
}

// ── Decay (compute-on-read) ─────────────────────────

export interface VaultNoteSummaryWithDecay extends VaultNoteSummary {
  effectiveConfidence: number;
  ageDays: number;
  isStale: boolean;
}

export async function vaultListNotesWithDecay(
  agentId: string | null,
  category: string | null,
  lambda: number,
  minConfidence: number,
  staleDays: number,
): Promise<VaultNoteSummaryWithDecay[]> {
  return invoke("vault_list_notes_with_decay", {
    agentId,
    category,
    lambda,
    minConfidence,
    staleDays,
  });
}

// ── Export / Import ──────────────────────────────────
// vault export/import는 기존 exportAgent/importAgent에 통합되어 있으므로
// 별도 커맨드 등록 없음 — 기존 exportAgent/importAgent가 vault를 자동으로 처리
