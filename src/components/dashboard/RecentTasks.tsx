import { useAgentStore } from "../../stores/agentStore";
import type { TaskStatus } from "../../services/types";
import { cn, formatDate } from "../../lib/utils";
import { AppIcon } from "../ui/AppIcon";
import { EmptyState } from "../ui/EmptyState";
import { SurfaceCard } from "../ui/SurfaceCard";

const statusBadge: Record<TaskStatus, { label: string; class: string }> = {
  pending: { label: "대기", class: "bg-surface-600/50 text-text-muted" },
  in_progress: { label: "진행 중", class: "bg-warning/12 text-warning" },
  completed: { label: "완료", class: "bg-success/12 text-success" },
  failed: { label: "실패", class: "bg-danger/12 text-danger" },
};

export function RecentTasks() {
  const tasks = useAgentStore((s) => s.tasks);
  const sorted = [...tasks].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <SurfaceCard>
      <h2 className="section-title">
        <AppIcon name="tasks" size={15} className="text-accent-400 drop-shadow-[0_0_4px_rgba(167,139,250,0.3)]" />
        <span>최근 작업</span>
        <span className="ml-auto rounded-full bg-gradient-to-r from-accent-500/15 to-cyan-500/10 px-2.5 py-0.5 text-xs font-medium text-accent-400">
          {tasks.length}건
        </span>
      </h2>
      <div className="max-h-80 space-y-3.5 overflow-y-auto pr-2">
        {sorted.map((task) => {
          const badge = statusBadge[task.status];
          return (
            <div
              key={task.id}
              className="flex items-center justify-between gap-5 rounded-xl px-5 py-4 transition-all duration-200 hover:bg-surface-700/40 hover:translate-x-1"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-text-primary">{task.title}</p>
                <p className="mt-1 text-xs text-text-muted">{formatDate(task.updatedAt)}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm",
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
