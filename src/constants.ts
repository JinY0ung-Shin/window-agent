import { i18n } from "./i18n";

// ── History & Conversation ──────────────────────────
export const MAX_HISTORY_MESSAGES = 10;

// ── Token Budget ───────────────────────────────────
export const MAX_CONTEXT_TOKENS = 1000000;
export const CONVERSATION_TITLE_MAX_LENGTH = 50;

// ── API Defaults ────────────────────────────────────
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-5.3-codex";
export const DEFAULT_THINKING_BUDGET = 4096;

// ── System Prompt ───────────────────────────────────
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful and fully capable desktop AI assistant. Reply in a concise, friendly manner. Respond in the same language as the user's prompt (usually Korean).";

// ── Error parsing ───────────────────────────────────

const ERROR_KEY_MAP: Record<string, string> = {
  HTTP_401: "common:errors.http401",
  HTTP_403: "common:errors.http403",
  HTTP_429: "common:errors.http429",
  HTTP_500: "common:errors.http500",
  HTTP_502: "common:errors.http502",
  HTTP_503: "common:errors.http503",
  PARSE_ERROR: "common:errors.parseError",
  EMPTY_RESPONSE: "common:errors.emptyResponse",
};

export function parseErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const match = msg.match(/(HTTP_\d{3}|PARSE_ERROR|EMPTY_RESPONSE):(.*)/s);
  const prefix = match?.[1];
  const serverDetail = match?.[2]?.trim();
  if (prefix && ERROR_KEY_MAP[prefix]) {
    const friendly = i18n.t(ERROR_KEY_MAP[prefix]);
    return serverDetail
      ? `${friendly}\n\n${i18n.t("common:serverResponse", { detail: serverDetail.slice(0, 300) })}`
      : friendly;
  }
  if (msg.includes("HTTP error") || msg.includes("fetch")) return i18n.t("common:errors.network");
  if (msg && msg !== "[object Object]") return msg;
  return i18n.t("common:apiError");
}
