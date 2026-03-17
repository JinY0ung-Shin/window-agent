import type { MemoryNote } from "./types";
import type { VaultNoteSummary } from "./vaultTypes";
import { estimateTokens } from "./tokenEstimator";

const MAX_MEMORY_TOKENS = 500;

/**
 * Vault 노트를 기존 MemoryNote 형태로 변환하는 어댑터.
 * 기존 UI/프롬프트 빌더가 수정 없이 작동하도록 보장한다.
 */
export function vaultNoteToLegacy(note: VaultNoteSummary): MemoryNote {
  return {
    id: note.id,
    agent_id: note.agent,
    title: note.title,
    content: note.bodyPreview,
    created_at: note.created,
    updated_at: note.updated,
  };
}

/**
 * 기존 buildMemorySection() (chatHelpers.ts:112-135) 의 정확한 재구현.
 * 기존 계약을 문자 그대로 보존한다:
 *   - 정렬: created 내림차순 (최신 우선)
 *   - 예산: MAX_MEMORY_TOKENS = 500 (estimateTokens 기반, 노트 개수 아님)
 *   - 형식: "- title: content" per line
 *   - 래핑: "[MEMORY NOTES]\n" 헤더
 */
export function buildPromptReadySlice(notes: VaultNoteSummary[]): string {
  if (notes.length === 0) return "";

  const sorted = [...notes].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
  );

  const lines: string[] = [];
  let tokens = estimateTokens("[MEMORY NOTES]\n");

  for (const note of sorted) {
    const line = `- ${note.title}: ${note.bodyPreview}`;
    const lineTokens = estimateTokens(line + "\n");
    if (tokens + lineTokens > MAX_MEMORY_TOKENS) break;
    tokens += lineTokens;
    lines.push(line);
  }

  if (lines.length === 0) return "";
  return `[MEMORY NOTES]\n${lines.join("\n")}`;
}
