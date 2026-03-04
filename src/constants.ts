// ── History & Conversation ──────────────────────────
export const MAX_HISTORY_MESSAGES = 10;
export const CONVERSATION_TITLE_MAX_LENGTH = 50;
export const DEFAULT_CONVERSATION_TITLE = "새 대화";

// ── API Defaults ────────────────────────────────────
export const DEFAULT_BASE_URL = "http://192.168.0.105:8317/v1";
export const DEFAULT_MODEL = "gpt-5.3-codex";
export const DEFAULT_THINKING_BUDGET = 4096;

// ── System Prompt ───────────────────────────────────
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful and fully capable desktop AI assistant. Reply in a concise, friendly manner. Respond in the same language as the user's prompt (usually Korean).";

// ── UI Messages ─────────────────────────────────────
export const LOADING_MESSAGE = "생각 중...";
export const ERROR_MESSAGE =
  "API 호출 중 오류가 발생했습니다. API 키가 정확한지 확인해 주세요.";
export const NO_RESPONSE_MESSAGE = "응답을 받지 못했습니다.";
