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

export async function createToolCallLog(
  conversationId: string,
  toolName: string,
  toolInput: string,
  messageId?: string | null,
): Promise<ToolCallLog> {
  return invoke("create_tool_call_log", { conversationId, messageId: messageId ?? null, toolName, toolInput });
}

export async function listToolCallLogs(conversationId: string): Promise<ToolCallLog[]> {
  return invoke("list_tool_call_logs", { conversationId });
}

export async function updateToolCallLogStatus(
  id: string,
  status: string,
  toolOutput?: string | null,
  durationMs?: number | null,
): Promise<void> {
  return invoke("update_tool_call_log_status", { id, status, toolOutput: toolOutput ?? null, durationMs: durationMs ?? null });
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
