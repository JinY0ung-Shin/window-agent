import type { Agent, AgentStatus } from "../../services/types";
import { cn } from "../../lib/utils";
import { AvatarBadge } from "../ui/AvatarBadge";
import { AppIcon } from "../ui/AppIcon";

const statusConfig: Record<
  AgentStatus,
  { label: string; color: string; dot: string; bg: string }
> = {
  online: { label: "온라인", color: "text-success", dot: "bg-success", bg: "bg-success/10" },
  busy: { label: "작업 중", color: "text-warning", dot: "bg-warning", bg: "bg-warning/10" },
  offline: { label: "오프라인", color: "text-text-muted", dot: "bg-text-muted", bg: "bg-surface-600" },
  error: { label: "오류", color: "text-danger", dot: "bg-danger", bg: "bg-danger/10" },
};

export function AgentStatusCard({ agent }: { agent: Agent }) {
  const status = statusConfig[agent.status];
  const progress =
    agent.totalTasks > 0
      ? Math.round((agent.completedTasks / agent.totalTasks) * 100)
      : 0;

  return (
    <div className="group rounded-xl border border-white/[0.08] bg-surface-700/45 p-3.5 transition-colors hover:bg-surface-700/70">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AvatarBadge name={agent.name} avatar={agent.avatar} size="lg" className="group-hover:border-accent-400/50" />
          <div>
            <h3 className="text-sm font-medium text-text-primary">{agent.name}</h3>
            <p className="text-xs text-text-secondary">{agent.role}</p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            status.bg,
            status.color
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>

      {agent.currentTask && (
        <p className="mb-3 flex items-center gap-1.5 truncate rounded-lg border border-white/[0.07] bg-surface-800/65 px-2.5 py-1.5 text-xs text-text-primary">
          <AppIcon name="tasks" size={13} className="text-text-secondary" />
          {agent.currentTask}
        </p>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] text-text-muted">작업 진행률</span>
          <span className="text-[11px] font-medium text-text-secondary">
            {agent.completedTasks}/{agent.totalTasks}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-800/85">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-500 to-accent-400 transition-all duration-500"
            style={{ width: progress === 0 ? "2px" : `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
