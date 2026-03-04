// ── Role types ──────────────────────────────────────
export type MessageRole = "user" | "assistant" | "system";
export type SaveMessageRole = "user" | "assistant";

// DB models (match Rust structs)
// TODO: Phase 1 — Rust 쪽 role도 enum으로 변경
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface SaveMessageRequest {
  conversation_id: string;
  role: SaveMessageRole;
  content: string;
}

// UI model
export interface ChatMessage {
  id: string;
  type: "user" | "agent";
  content: string;
  reasoningContent?: string;
  isLoading?: boolean;
}
