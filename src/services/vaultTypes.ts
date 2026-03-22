// ── Vault note types ─────────────────────────────────

export type NoteType = "knowledge" | "conversation" | "decision" | "reflection";
export type NoteScope = "agent" | "shared";

export interface VaultNote {
  id: string;
  agent: string;
  noteType: NoteType;      // serde camelCase
  scope: string | null;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  created: string;
  updated: string;
  revision: string;
  source: string | null;
  aliases: string[];
  legacyId: string | null; // serde camelCase
  lastEditedBy: string | null;
  path: string;
}

export interface VaultNoteSummary {
  id: string;
  agent: string;
  noteType: NoteType;   // Rust: note_type → serde camelCase: noteType
  title: string;
  bodyPreview: string;  // 첫 200자 (stripped content)
  tags: string[];
  confidence: number;
  scope: string | null;
  sourceConversation: string | null;
  created: string;
  updated: string;
}

// ── Graph types ──────────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  agent: string;
  noteType: string;     // Rust: note_type → camelCase
  tags: string[];
  confidence: number;
  updatedAt: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  edgeType: string;     // Rust: edge_type → camelCase
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Search types ─────────────────────────────────────

export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  score: number;
}

// ── Link types ──────────────────────────────────────

export interface LinkRef {
  sourceId: string;
  targetId: string;
  rawLink: string;
  displayText: string | null;
  lineNumber: number;
  resolved: boolean;
}

// ── Conflict types ───────────────────────────────────

export interface ConflictInfo {
  noteId: string;
  localRevision: string;
  diskRevision: string;
  conflictCopyPath: string;
}

// ── Parameter types ──────────────────────────────────

export interface CreateNoteParams {
  agentId: string;
  scope?: NoteScope;
  category: NoteType;
  title: string;
  content: string;
  tags?: string[];
  relatedIds?: string[];
}

export interface NoteUpdates {
  title?: string;
  content?: string;
  tags?: string[];
  confidence?: number;
  addLinks?: string[];
}

export interface IndexStats {
  totalNotes: number;
  totalLinks: number;
  brokenLinks: number;
}

// ── Decay types ─────────────────────────────────────

export interface VaultNoteSummaryWithDecay extends VaultNoteSummary {
  effectiveConfidence: number;
  ageDays: number;
  isStale: boolean;
}
