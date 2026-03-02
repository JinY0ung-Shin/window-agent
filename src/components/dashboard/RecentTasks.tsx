import { useAgentStore } from "../../stores/agentStore";
import type { TaskStatus } from "../../services/types";
import { cn, formatDate } from "../../lib/utils";
import { AppIcon } from "../ui/AppIcon";
import { EmptyState } from "../ui/EmptyState";
import { SurfaceCard } from "../ui/SurfaceCard";

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
    <SurfaceCard>
      <h2 className="section-title">
        <AppIcon name="tasks" size={15} className="text-accent-400" />
        <span>최근 작업</span>
        <span className="ml-auto rounded-full bg-surface-700/70 px-2 py-0.5 text-xs font-medium text-text-secondary">
          {tasks.length}건
        </span>
      </h2>
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {sorted.map((task) => {
          const badge = statusBadge[task.status];
          return (
            <div
              key={task.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-surface-700/45 p-3 transition-colors hover:bg-surface-700/62"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text-primary">{task.title}</p>
                <p className="mt-0.5 text-xs text-text-muted">{formatDate(task.updatedAt)}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                  badge.class
                )}
              >
                {badge.label}
              </span>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <EmptyState
            icon="empty"
            title="아직 작업이 없습니다"
            description="대화를 통해 에이전트에게 첫 작업을 지시해 보세요."
            className="py-10"
          />
        )}
      </div>
    </SurfaceCard>
  );
}
