import { useEffect } from "react";
import { useHrStore } from "../../stores/hrStore";
import type { AgentStatus } from "../../services/types";
import { formatDate } from "../../lib/utils";

const agentEmoji: Record<string, string> = {
  "김비서": "👩‍💼",
  "박개발": "💻",
  "이분석": "📊",
  "최기획": "📝",
  "정조사": "🔍",
  "한디자": "🎨",
  "강관리": "📁",
  "윤자동": "🔧",
};

const statusConfig: Record<AgentStatus, { label: string; className: string }> = {
  online: { label: "온라인", className: "bg-success/10 text-success" },
  busy: { label: "작업중", className: "bg-warning/10 text-warning" },
  offline: { label: "오프라인", className: "bg-surface-600 text-text-muted" },
  error: { label: "오류", className: "bg-danger/10 text-danger" },
};

const toolLabels: Record<string, string> = {
  file_read: "파일 읽기",
  file_write: "파일 쓰기",
  shell_execute: "셸 실행",
  browser: "브라우저",
  web_search: "웹 검색",
};

export function AgentProfileCard() {
  const {
    showProfileCard,
    selectedAgent,
    closeProfileCard,
  } = useHrStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProfileCard();
    };
    if (showProfileCard) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showProfileCard, closeProfileCard]);

  if (!showProfileCard || !selectedAgent) return null;

  const emoji = agentEmoji[selectedAgent.name] || selectedAgent.avatar || "🤖";
  const status = statusConfig[selectedAgent.status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeProfileCard}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-auto">
        <button
          onClick={closeProfileCard}
          className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <div className="flex flex-col items-center mb-6">
          <span className="text-5xl mb-3">{emoji}</span>
          <h2 className="text-xl font-semibold text-text-primary">
            {selectedAgent.name}
          </h2>
          <p className="text-sm text-text-secondary">{selectedAgent.role}</p>
          <span
            className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${status.className}`}
          >
            {status.label}
          </span>
        </div>

        <div className="space-y-4">
          <div className="bg-surface-700/40 rounded-xl p-4">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              기본 정보
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">부서</span>
                <span className="text-text-primary">
                  {selectedAgent.department}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">AI 백엔드</span>
                <span className="text-text-primary">
                  {selectedAgent.aiBackend}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">모델</span>
                <span className="text-text-primary">
                  {selectedAgent.model}
                </span>
              </div>
              {selectedAgent.hiredAt && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">채용일</span>
                  <span className="text-text-primary">
                    {formatDate(selectedAgent.hiredAt)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-text-secondary">완료 작업</span>
                <span className="text-text-primary">
                  {selectedAgent.completedTasks} / {selectedAgent.totalTasks}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-surface-700/40 rounded-xl p-4">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              성격
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              {selectedAgent.personality || "설정되지 않음"}
            </p>
          </div>

          <div className="bg-surface-700/40 rounded-xl p-4">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              도구
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedAgent.tools.length > 0 ? (
                selectedAgent.tools.split(",").filter(Boolean).map((tool: string) => (
                  <span
                    key={tool}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent-500/10 text-accent-400"
                  >
                    {toolLabels[tool] || tool}
                  </span>
                ))
              ) : (
                <span className="text-sm text-text-muted">
                  도구가 설정되지 않았습니다
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
