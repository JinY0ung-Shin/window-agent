import { useAgentStore } from "../../stores/agentStore";
import type { TaskStatus } from "../../services/types";
import { cn, formatDate } from "../../lib/utils";

const statusBadge: Record<TaskStatus, { label: string; class: string }> = {
  pending: { label: "대기", class: "bg-surface-600 text-text-muted" },
  in_progress: { label: "진행 중", class: "bg-warning/15 text-warning" },
  completed: { label: "완료", class: "bg-success/15 text-success" },
  failed: { label: "실패", class: "bg-danger/15 text-danger" },
};

export function RecentTasks() {
  const tasks = useAgentStore((s) => s.tasks);
  const sorted = [...tasks].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="card">
      <h2 className="section-title">
        <span>📝</span>
        <span>최근 작업</span>
        <span className="ml-auto text-xs font-normal text-text-muted bg-surface-700/60 px-2 py-0.5 rounded-full">
          {tasks.length}건
        </span>
      </h2>
      <div className="space-y-2">
        {sorted.map((task) => {
          const badge = statusBadge[task.status];
          return (
            <div
              key={task.id}
              className="bg-surface-700/40 rounded-xl p-3 flex items-center justify-between gap-3 hover:bg-surface-700/60 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate">{task.title}</p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  {formatDate(task.updatedAt)}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-[10px] px-2.5 py-1 rounded-full font-medium",
                  badge.class
                )}
              >
                {badge.label}
              </span>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-center py-10">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-xs text-text-muted">아직 작업이 없습니다</p>
            <p className="text-[10px] text-text-muted mt-1">에이전트에게 지시를 내려보세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
