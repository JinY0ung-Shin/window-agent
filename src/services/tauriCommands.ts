import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  ConversationDetail,
  DbMessage,
  SaveMessageRequest,
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
  MemoryNote,
  ToolCallLog,
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

export async function deleteMessagesFrom(conversationId: string, messageId: string): Promise<void> {
  return invoke("delete_messages_from", { conversationId, messageId });
}

export async function getConversationDetail(id: string): Promise<ConversationDetail> {
  return invoke("get_conversation_detail", { id });
}

export async function updateConversationTitle(id: string, title: string, expectedCurrent?: string | null): Promise<number> {
  return invoke("update_conversation_title", { id, title, expectedCurrent: expectedCurrent ?? null });
}

export async function updateConversationSummary(
  id: string,
  summary: string,
  upToMessageId: string,
  expectedPrevious: string | null,
): Promise<number> {
  return invoke("update_conversation_summary", { id, summary, upToMessageId, expectedPrevious });
}

export async function deleteMessagesAndMaybeResetSummary(
  conversationId: string,
  messageId: string,
): Promise<{ summary_was_reset: boolean }> {
  return invoke("delete_messages_and_maybe_reset_summary", { conversationId, messageId });
}

// ── Memory Notes ──

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

// ── Config commands ──

export interface EnvConfig {
  base_url: string | null;
  model: string | null;
}

export async function getEnvConfig(): Promise<EnvConfig> {
  return invoke("get_env_config");
}

// ── API commands ──

export async function hasApiKey(): Promise<boolean> {
  return invoke("has_api_key");
}

export interface SetApiConfigRequest {
  api_key?: string | null;
  base_url?: string | null;
}

export async function setApiConfig(request: SetApiConfigRequest): Promise<void> {
  return invoke("set_api_config", { request });
}

export interface ChatCompletionRequest {
  messages: { role: string; content: string }[];
  system_prompt: string;
  model: string;
  temperature?: number | null;
  thinking_enabled: boolean;
  thinking_budget?: number | null;
}

export interface ChatCompletionResponse {
  content: string;
  reasoning_content: string | null;
}

export async function chatCompletion(
  request: ChatCompletionRequest,
): Promise<ChatCompletionResponse> {
  return invoke("chat_completion", { request });
}

export interface BootstrapCompletionRequest {
  messages: any[];
  model: string;
  tools: any[];
}

export interface BootstrapCompletionResponse {
  message: any;
}

export async function bootstrapCompletion(
  request: BootstrapCompletionRequest,
): Promise<BootstrapCompletionResponse> {
  return invoke("bootstrap_completion", { request });
}

export async function listModels(): Promise<string[]> {
  return invoke("list_models");
}

// ── Abort ──

export async function abortStream(requestId: string): Promise<boolean> {
  return invoke("abort_stream", { requestId });
}

// ── Streaming API ──

export async function chatCompletionStream(request: {
  messages: Record<string, unknown>[];
  system_prompt: string;
  model: string;
  temperature: number | null;
  thinking_enabled: boolean;
  thinking_budget: number | null;
  request_id: string;
  tools?: object[] | null;
}): Promise<void> {
  return invoke("chat_completion_stream", {
    request: {
      messages: request.messages,
      system_prompt: request.system_prompt,
      model: request.model,
      temperature: request.temperature,
      thinking_enabled: request.thinking_enabled,
      thinking_budget: request.thinking_budget,
      tools: request.tools ?? null,
    },
    requestId: request.request_id,
  });
}

// ── Export / Import ──

export async function exportConversation(conversationId: string): Promise<string> {
  return invoke("export_conversation", { conversationId });
}

export async function exportAgent(
  agentId: string,
  includeConversations: boolean,
): Promise<number[]> {
  return invoke("export_agent", { agentId, includeConversations });
}

export interface ImportResult {
  agents_imported: number;
  conversations_imported: number;
  messages_imported: number;
  memory_notes_imported: number;
  warnings: string[];
}

export async function importAgent(zipBytes: number[]): Promise<ImportResult> {
  return invoke("import_agent", { zipBytes });
}
