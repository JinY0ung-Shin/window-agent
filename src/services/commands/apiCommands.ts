import { invoke } from "@tauri-apps/api/core";

// ── Config ──

export interface EnvConfig {
  base_url: string | null;
  model: string | null;
}

export async function getEnvConfig(): Promise<EnvConfig> {
  return invoke("get_env_config");
}

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

// ── Chat completion ──

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

// ── Streaming ──

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
