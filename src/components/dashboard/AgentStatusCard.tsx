import type { Agent, AgentStatus } from "../../services/types";
import { cn } from "../../lib/utils";
import { AvatarBadge } from "../ui/AvatarBadge";
import { AppIcon } from "../ui/AppIcon";

const statusConfig: Record<
  AgentStatus,
  { label: string; color: string; dot: string; bg: string }
> = {
  online: { label: "온라인", color: "text-success", dot: "bg-success shadow-[0_0_6px_rgba(52,211,153,0.5)]", bg: "bg-success/10" },
  busy: { label: "작업 중", color: "text-warning", dot: "bg-warning shadow-[0_0_6px_rgba(251,191,36,0.5)]", bg: "bg-warning/10" },
  offline: { label: "오프라인", color: "text-text-muted", dot: "bg-text-muted", bg: "bg-surface-600/50" },
  error: { label: "오류", color: "text-danger", dot: "bg-danger shadow-[0_0_6px_rgba(248,113,113,0.5)]", bg: "bg-danger/10" },
};

export function AgentStatusCard({ agent }: { agent: Agent }) {
  const status = statusConfig[agent.status];
  const progress =
    agent.totalTasks > 0
      ? Math.round((agent.completedTasks / agent.totalTasks) * 100)
      : 0;

  return (
    <div className="group relative rounded-2xl p-5 transition-all duration-300 hover:bg-surface-700/40">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <AvatarBadge name={agent.name} avatar={agent.avatar} size="lg" className="transition-all duration-300 group-hover:shadow-[0_0_12px_rgba(124,58,237,0.2)]" />
          <div>
            <h3 className="text-sm font-medium text-text-primary">{agent.name}</h3>
            <p className="text-xs text-text-secondary">{agent.role}</p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium backdrop-blur-sm",
            status.bg,
            status.color
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>

      {agent.currentTask && (
        <p className="mb-5 flex items-center gap-2.5 truncate rounded-lg bg-surface-800/40 px-4 py-3 text-xs text-text-primary">
          <AppIcon name="tasks" size={13} className="text-accent-400/70" />
          {agent.currentTask}
        </p>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] text-text-muted">작업 진행률</span>
          <span className="text-[11px] font-medium text-text-secondary">
            {agent.completedTasks}/{agent.totalTasks}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-800/70">
          <div
            className="shimmer-bar h-full rounded-full transition-all duration-700"
            style={{ width: progress === 0 ? "2px" : `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
