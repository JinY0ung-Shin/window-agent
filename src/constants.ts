// ── History & Conversation ──────────────────────────
export const MAX_HISTORY_MESSAGES = 10;

// ── Token Budget ───────────────────────────────────
export const MAX_CONTEXT_TOKENS = 8000;
export const CONVERSATION_TITLE_MAX_LENGTH = 50;
export const DEFAULT_CONVERSATION_TITLE = "새 대화";

// ── API Defaults ────────────────────────────────────
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-5.3-codex";
export const DEFAULT_THINKING_BUDGET = 4096;

// ── System Prompt ───────────────────────────────────
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful and fully capable desktop AI assistant. Reply in a concise, friendly manner. Respond in the same language as the user's prompt (usually Korean).";

// ── Agent Defaults ──────────────────────────────────
export const DEFAULT_AGENT_NAME = "새 에이전트";

// ── Summary Generation ─────────────────────────────
export const SUMMARY_GENERATION_PROMPT =
  "대화 요약기입니다. 이전 요약과 새 메시지를 통합하여 간결한 요약을 생성하세요. 핵심 사실, 결정 사항, 사용자 선호만 포함. 200자 이내. 한국어로 작성하세요.";

// ── Default TOOLS.md Template ───────────────────────
export const DEFAULT_TOOLS_MD = `# Tools

## read_file
- description: 지정 경로의 파일 내용을 읽습니다
- tier: auto
- parameters:
  - path (string, required): 파일 경로

## write_file
- description: 지정 경로에 파일을 씁니다
- tier: confirm
- parameters:
  - path (string, required): 파일 경로
  - content (string, required): 파일 내용

## list_directory
- description: 디렉토리 내 파일 목록을 조회합니다
- tier: auto
- parameters:
  - path (string, required): 디렉토리 경로

## web_search
- description: 웹에서 정보를 검색합니다
- tier: confirm
- parameters:
  - query (string, required): 검색 쿼리 또는 URL

## memory_note
- description: 에이전트 메모리 노트를 관리합니다
- tier: auto
- parameters:
  - action (string, required): create | read | update | delete
  - title (string, required): 노트 제목
  - content (string, optional): 노트 내용
`;

// ── UI Messages ─────────────────────────────────────
export const LOADING_MESSAGE = "생각 중...";
export const ERROR_MESSAGE =
  "API 호출 중 오류가 발생했습니다. API 키가 정확한지 확인해 주세요.";
export const NO_RESPONSE_MESSAGE = "응답을 받지 못했습니다.";

export const ERROR_MESSAGES: Record<string, string> = {
  HTTP_401: "API 키가 유효하지 않습니다. 설정에서 확인해 주세요.",
  HTTP_403: "API 접근 권한이 없습니다.",
  HTTP_429: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  HTTP_500: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  HTTP_502: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  HTTP_503: "서비스가 일시적으로 중단되었습니다.",
  PARSE_ERROR: "응답을 처리할 수 없습니다.",
  EMPTY_RESPONSE: "빈 응답을 받았습니다.",
  NETWORK: "네트워크 연결을 확인해 주세요.",
};

export function parseErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const prefix = msg.match(/(HTTP_\d{3}|PARSE_ERROR|EMPTY_RESPONSE):/)?.[1];
  if (prefix && ERROR_MESSAGES[prefix]) return ERROR_MESSAGES[prefix];
  if (msg.includes("HTTP error") || msg.includes("fetch")) return ERROR_MESSAGES.NETWORK;
  // Show actual error instead of generic message for debugging
  if (msg && msg !== "[object Object]") return msg;
  return ERROR_MESSAGE;
}
