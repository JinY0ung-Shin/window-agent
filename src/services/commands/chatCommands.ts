import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  ConversationDetail,
  DbMessage,
  SaveMessageRequest,
  ToolCallLog,
} from "../types";

// ── Conversation CRUD ──

export async function createConversation(
  agentId: string,
  title?: string,
): Promise<Conversation> {
  return invoke("create_conversation", { title: title ?? null, agentId });
}

export async function getConversations(): Promise<Conversation[]> {
  return invoke("get_conversations");
}

export async function createTeamConversation(
  teamId: string,
  leaderAgentId: string,
  title?: string,
): Promise<Conversation> {
  return invoke("create_team_conversation", { teamId, leaderAgentId, title: title ?? null });
}

export async function getConversationDetail(id: string): Promise<ConversationDetail> {
  return invoke("get_conversation_detail", { id });
}

export async function updateConversationSummary(
  id: string,
  summary: string,
  upToMessageId: string,
  expectedPrevious: string | null,
): Promise<number> {
  return invoke("update_conversation_summary", { id, summary, upToMessageId, expectedPrevious });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  return invoke("delete_conversation", { conversationId });
}

// ── Learning Mode ──

export async function setLearningMode(id: string, enabled: boolean): Promise<void> {
  return invoke("set_learning_mode", { id, enabled });
}

// ── Message CRUD ──

export async function getMessages(conversationId: string): Promise<DbMessage[]> {
  return invoke("get_messages", { conversationId });
}

export async function saveMessage(request: SaveMessageRequest): Promise<DbMessage> {
  return invoke("save_message", { request });
}

export async function deleteMessagesAndMaybeResetSummary(
  conversationId: string,
  messageId: string,
): Promise<{ summary_was_reset: boolean }> {
  return invoke("delete_messages_and_maybe_reset_summary", { conversationId, messageId });
}

// ── Tool Call Logs ──

export async function listToolCallLogs(conversationId: string): Promise<ToolCallLog[]> {
  return invoke("list_tool_call_logs", { conversationId });
}

// ── Tool Execution ──

export interface ToolExecutionResult {
  tool_call_log_id: string;
  status: string;
  output: string;
  duration_ms: number;
}

export async function executeTool(
  toolName: string,
  toolInput: string,
  conversationId: string,
): Promise<ToolExecutionResult> {
  return invoke("execute_tool", { toolName, toolInput, conversationId });
}

// ── System Memory (Consolidation) ──

export interface PendingConsolidation {
  conversation_id: string;
  agent_id: string;
}

export async function readConsolidatedMemory(agentId: string): Promise<string | null> {
  return invoke("read_consolidated_memory", { agentId });
}

export async function listPendingConsolidations(): Promise<PendingConsolidation[]> {
  return invoke("list_pending_consolidations");
}

export async function readDigest(agentId: string, conversationId: string): Promise<string | null> {
  return invoke("read_digest", { agentId, conversationId });
}

export async function writeDigest(agentId: string, conversationId: string, content: string): Promise<string> {
  return invoke("write_digest", { agentId, conversationId, content });
}

export async function writeConsolidatedMemory(agentId: string, content: string, version: number): Promise<void> {
  return invoke("write_consolidated_memory", { agentId, content, version });
}

export async function updateConversationDigest(conversationId: string, digestId: string | null): Promise<void> {
  return invoke("update_conversation_digest", { conversationId, digestId });
}

export async function updateConversationConsolidated(conversationId: string): Promise<void> {
  return invoke("update_conversation_consolidated", { conversationId });
}

export async function archiveConversationNotes(conversationId: string, agentId: string): Promise<number> {
  return invoke("archive_conversation_notes", { conversationId, agentId });
}

// ── Team Run ──

export async function abortTeamRun(runId: string): Promise<void> {
  return invoke("abort_team_run", { runId });
}
