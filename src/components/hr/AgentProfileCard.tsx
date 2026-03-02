import { useHrStore } from "../../stores/hrStore";
import type { AgentStatus } from "../../services/types";
import { formatDate } from "../../lib/utils";
import { AvatarBadge } from "../ui/AvatarBadge";
import { ModalShell } from "../ui/ModalShell";

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
  const { showProfileCard, selectedAgent, closeProfileCard } = useHrStore();

  if (!showProfileCard || !selectedAgent) return null;

  const status = statusConfig[selectedAgent.status];

  return (
    <ModalShell
      isOpen={showProfileCard}
      onClose={closeProfileCard}
      title="에이전트 프로필"
      size="md"
      bodyClassName="max-h-[78vh]"
    >
      <div className="mb-5 flex flex-col items-center">
        <AvatarBadge name={selectedAgent.name} avatar={selectedAgent.avatar} size="lg" className="h-14 w-14 text-lg" />
        <h2 className="mt-3 text-xl font-semibold text-text-primary">{selectedAgent.name}</h2>
        <p className="text-sm text-text-secondary">{selectedAgent.role}</p>
        <span
          className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-white/[0.08] bg-surface-700/40 p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">기본 정보</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">부서</span>
              <span className="text-text-primary">{selectedAgent.department}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">AI 백엔드</span>
              <span className="text-text-primary">{selectedAgent.aiBackend}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">모델</span>
              <span className="text-text-primary">{selectedAgent.model}</span>
            </div>
            {selectedAgent.hiredAt && (
              <div className="flex justify-between">
                <span className="text-text-secondary">채용일</span>
                <span className="text-text-primary">{formatDate(selectedAgent.hiredAt)}</span>
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

        <div className="rounded-xl border border-white/[0.08] bg-surface-700/40 p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">성격</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            {selectedAgent.personality || "설정되지 않음"}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-surface-700/40 p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">도구</h3>
          <div className="flex flex-wrap gap-2">
            {selectedAgent.tools.length > 0 ? (
              selectedAgent.tools
                .split(",")
                .filter(Boolean)
                .map((tool: string) => (
                  <span
                    key={tool}
                    className="inline-flex items-center rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-400"
                  >
                    {toolLabels[tool] || tool}
                  </span>
                ))
            ) : (
              <span className="text-sm text-text-muted">도구가 설정되지 않았습니다</span>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
