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
    <div>
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        최근 작업
      </h2>
      <div className="space-y-2">
        {sorted.map((task) => {
          const badge = statusBadge[task.status];
          return (
            <div
              key={task.id}
              className="bg-surface-800 rounded-lg p-3 border border-surface-700 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate">{task.title}</p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  {formatDate(task.updatedAt)}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium",
                  badge.class
                )}
              >
                {badge.label}
              </span>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-xs text-text-muted py-8 text-center">
            작업이 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
