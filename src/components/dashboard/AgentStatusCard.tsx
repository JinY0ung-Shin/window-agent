import type { Agent, AgentStatus } from "../../services/types";
import { cn } from "../../lib/utils";

const statusConfig: Record<AgentStatus, { label: string; color: string; dot: string }> = {
  online: { label: "온라인", color: "text-success", dot: "bg-success" },
  busy: { label: "작업 중", color: "text-warning", dot: "bg-warning" },
  offline: { label: "오프라인", color: "text-text-muted", dot: "bg-text-muted" },
  error: { label: "오류", color: "text-danger", dot: "bg-danger" },
};

export function AgentStatusCard({ agent }: { agent: Agent }) {
  const status = statusConfig[agent.status];
  const progress =
    agent.totalTasks > 0
      ? Math.round((agent.completedTasks / agent.totalTasks) * 100)
      : 0;

  return (
    <div className="bg-surface-800 rounded-xl p-4 border border-surface-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent-500/20 flex items-center justify-center text-sm text-accent-400 font-semibold">
            {agent.name.charAt(0)}
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">{agent.name}</h3>
            <p className="text-xs text-text-muted">{agent.role}</p>
          </div>
        </div>
        <div className={cn("flex items-center gap-1.5", status.color)}>
          <div className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
          <span className="text-xs">{status.label}</span>
        </div>
      </div>

      {agent.currentTask && (
        <p className="text-xs text-text-secondary mb-3 truncate">
          {agent.currentTask}
        </p>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-text-muted">작업 진행률</span>
          <span className="text-[10px] text-text-secondary">
            {agent.completedTasks}/{agent.totalTasks}
          </span>
        </div>
        <div className="h-1.5 bg-surface-600 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
