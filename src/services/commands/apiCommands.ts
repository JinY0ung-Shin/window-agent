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

/** Returns true only if an actual API key string is stored (not just proxy URL). */
export async function hasStoredKey(): Promise<boolean> {
  return invoke("has_stored_key");
}

export interface SetApiConfigRequest {
  api_key?: string | null;
  base_url?: string | null;
}

export async function setApiConfig(request: SetApiConfigRequest): Promise<void> {
  return invoke("set_api_config", { request });
}

// ── Unified App Settings ──

export interface AppSettingsInner {
  model_name: string;
  thinking_enabled: boolean;
  thinking_budget: number;
  ui_theme: string;
  company_name: string;
  branding_initialized: boolean;
  locale: string;
  // Relay
  network_enabled: boolean;
  relay_url: string;
  allowed_tools: string[];
  discoverable: boolean;
  directory_agent_name: string;
  directory_agent_description: string;
  // Browser
  browser_headless: boolean;
  browser_proxy: string;
  browser_no_proxy: string;
}

export interface AppSettingsPatch {
  model_name?: string | null;
  thinking_enabled?: boolean | null;
  thinking_budget?: number | null;
  ui_theme?: string | null;
  company_name?: string | null;
  branding_initialized?: boolean | null;
  locale?: string | null;
  // Relay
  network_enabled?: boolean | null;
  relay_url?: string | null;
  allowed_tools?: string[] | null;
  discoverable?: boolean | null;
  directory_agent_name?: string | null;
  directory_agent_description?: string | null;
  // Browser
  browser_headless?: boolean | null;
  browser_proxy?: string | null;
  browser_no_proxy?: string | null;
}

export async function getAppSettings(): Promise<AppSettingsInner> {
  return invoke("get_app_settings");
}

export async function setAppSettings(patch: AppSettingsPatch): Promise<void> {
  return invoke("set_app_settings", { patch });
}

export async function migrateFrontendSettings(
  values: Record<string, string | null>,
): Promise<void> {
  return invoke("migrate_frontend_settings", { values });
}

export async function getNoProxy(): Promise<boolean> {
  return invoke("get_no_proxy");
}

export async function setNoProxy(enabled: boolean): Promise<void> {
  return invoke("set_no_proxy", { enabled });
}

// ── Browser Settings ──

export async function getBrowserHeadless(): Promise<boolean> {
  return invoke("get_browser_headless");
}

export async function setBrowserHeadless(headless: boolean): Promise<void> {
  return invoke("set_browser_headless", { headless });
}

export async function getBrowserProxy(): Promise<string> {
  return invoke("get_browser_proxy");
}

export async function setBrowserProxy(proxy: string): Promise<void> {
  return invoke("set_browser_proxy", { proxy });
}

export async function detectSystemProxy(): Promise<string> {
  return invoke("detect_system_proxy");
}

export async function getBrowserNoProxy(): Promise<string> {
  return invoke("get_browser_no_proxy");
}

export async function setBrowserNoProxy(noProxy: string): Promise<void> {
  return invoke("set_browser_no_proxy", { noProxy });
}

export async function detectSystemNoProxy(): Promise<string> {
  return invoke("detect_system_no_proxy");
}

// ── Shell Info ──

export interface ShellInfo {
  program: string;
  is_posix: boolean;
  shell_type: string;
  ssh_hardening: boolean;
}

export async function getShellInfo(): Promise<ShellInfo> {
  return invoke("get_shell_info");
}

export interface ApiHealthCheckRequest {
  api_key?: string | null;
  base_url?: string | null;
}

export interface ApiHealthCheckResponse {
  ok: boolean;
  base_url: string;
  authorization_header_sent: boolean;
  api_key_preview: string;
  detail: string;
}

export async function checkApiHealth(
  request: ApiHealthCheckRequest,
): Promise<ApiHealthCheckResponse> {
  return invoke("check_api_health", { request });
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

// ── OpenAI-compatible types for bootstrap API ──

export interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: OpenAIFunctionCall;
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OpenAITool {
  type: "function";
  function: OpenAIToolFunction;
}

export interface BootstrapCompletionRequest {
  messages: OpenAIMessage[];
  model: string;
  tools: OpenAITool[];
}

export interface BootstrapCompletionResponse {
  message: OpenAIMessage;
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
