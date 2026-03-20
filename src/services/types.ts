// ── Role types ──────────────────────────────────────
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type SaveMessageRole = "user" | "assistant" | "tool";

// DB models (match Rust structs)
export interface ConversationListItem {
  id: string;
  title: string;
  agent_id: string;
  team_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends ConversationListItem {
  summary?: string;
  summary_up_to_message_id?: string;
  active_skills?: string[];
  learning_mode?: boolean;
  digest_id?: string | null;
  consolidated_at?: string | null;
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
  sender_agent_id?: string | null;
  team_run_id?: string | null;
  team_task_id?: string | null;
  created_at: string;
}

export interface SaveMessageRequest {
  conversation_id: string;
  role: SaveMessageRole;
  content: string;
  tool_call_id?: string | null;
  tool_name?: string | null;
  tool_input?: string | null;
  sender_agent_id?: string | null;
  team_run_id?: string | null;
  team_task_id?: string | null;
}

export interface MemoryNote {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  source_conversation?: string | null;
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
  artifact_id: string | null;
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
}

// ── Tool config types ─────────────────────────────────
export interface ToolConfig {
  version: number;
  auto_approve?: boolean;
  native: Record<string, { enabled: boolean; tier: ToolPermissionTier }>;
  credentials?: Record<string, { allowed: boolean }>;
}

// ── Credential types ──────────────────────────────────
export interface CredentialMeta {
  id: string;
  name: string;
  allowed_hosts: string[];
  created_at: string;
  updated_at: string;
}

export interface NativeToolDef {
  name: string;
  description: string;
  category: string;
  default_tier: ToolPermissionTier;
  parameters: Record<string, unknown>;
}

// ── Tool calling types ──────────────────────────────
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
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
  senderAgentId?: string;
  senderAgentName?: string;
  senderAgentAvatar?: string | null;
  teamRunId?: string;
  teamTaskId?: string;
}

export interface ActiveRun {
  requestId: string;
  conversationId: string;
  targetMessageId: string;
  status: MessageStatus;
}

// ── Team types ───────────────────────────────────────
export interface Team {
  id: string;
  name: string;
  description: string;
  leader_agent_id: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  agent_id: string;
  role: 'leader' | 'member';
  joined_at: string;
}

export interface TeamDetail {
  team: Team;
  members: TeamMember[];
}

export interface TeamRun {
  id: string;
  team_id: string;
  conversation_id: string;
  leader_agent_id: string;
  status: 'running' | 'waiting_reports' | 'synthesizing' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  finished_at: string | null;
}

export interface TeamTask {
  id: string;
  run_id: string;
  agent_id: string;
  request_id: string | null;
  task_description: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  parent_message_id: string | null;
  result_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export type ExecutionRole = 'dm' | 'team_leader' | 'team_member';

// ── Skill types ──────────────────────────────────────
export interface SkillMetadata {
  name: string;
  description: string;
  source: "agent" | "global";
  path: string;
  compatibility?: string;
  license?: string;
  metadata_map?: Record<string, string>;
  diagnostics: string[];
}

export interface SkillContent {
  metadata: SkillMetadata;
  body: string;
  raw_content: string;
  resource_files: string[];
}
