// ── Role types ──────────────────────────────────────
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type SaveMessageRole = "user" | "assistant" | "tool";

// DB models (match Rust structs)
export interface ConversationListItem {
  id: string;
  title: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends ConversationListItem {
  summary?: string;
  summary_up_to_message_id?: string;
}

// Backward-compatible alias
export type Conversation = ConversationListItem;

export interface DbMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_call_id?: string | null;
  tool_name?: string | null;
  tool_input?: string | null;
  created_at: string;
}

export interface SaveMessageRequest {
  conversation_id: string;
  role: SaveMessageRole;
  content: string;
  tool_call_id?: string | null;
  tool_name?: string | null;
  tool_input?: string | null;
}

export interface MemoryNote {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ToolCallLog {
  id: string;
  conversation_id: string;
  message_id: string | null;
  tool_name: string;
  tool_input: string;
  tool_output: string | null;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

// Agent model (matches Rust Agent struct — serde serializes bool, not integer)
export interface Agent {
  id: string;
  folder_name: string;
  name: string;
  avatar: string | null;
  description: string;
  model: string | null;
  temperature: number | null;
  thinking_enabled: boolean | null;
  thinking_budget: number | null;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentRequest {
  folder_name: string;
  name: string;
  description?: string;
  avatar?: string | null;
  model?: string | null;
  temperature?: number | null;
  thinking_enabled?: boolean | null;
  thinking_budget?: number | null;
  is_default?: boolean;
  sort_order?: number;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  avatar?: string | null;
  model?: string | null;
  temperature?: number | null;
  thinking_enabled?: boolean | null;
  thinking_budget?: number | null;
  sort_order?: number;
}

// Persona files for an agent
export interface PersonaFiles {
  identity: string;
  soul: string;
  user: string;
  agents: string;
  tools: string;
}

// ── Tool calling types ──────────────────────────────
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

export type ToolPermissionTier = "auto" | "confirm" | "deny";
export type ToolRunState = "idle" | "streaming" | "tool_pending" | "tool_waiting" | "tool_running" | "continuing";

// UI model
export type MessageStatus = "pending" | "streaming" | "complete" | "failed" | "aborted";

export interface ChatMessage {
  id: string;
  type: "user" | "agent" | "tool";
  content: string;
  reasoningContent?: string;
  status: MessageStatus;
  requestId?: string;
  dbMessageId?: string;
  error?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
}

export interface ActiveRun {
  requestId: string;
  conversationId: string;
  targetMessageId: string;
  status: MessageStatus;
}
