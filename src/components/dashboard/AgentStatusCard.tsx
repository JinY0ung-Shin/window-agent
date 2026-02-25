import type { Agent, AgentStatus } from "../../services/types";
import { cn } from "../../lib/utils";

const statusConfig: Record<AgentStatus, { label: string; color: string; dot: string; bg: string }> = {
  online: { label: "온라인", color: "text-success", dot: "bg-success", bg: "bg-success/10" },
  busy: { label: "작업 중", color: "text-warning", dot: "bg-warning", bg: "bg-warning/10" },
  offline: { label: "오프라인", color: "text-text-muted", dot: "bg-text-muted", bg: "bg-surface-600" },
  error: { label: "오류", color: "text-danger", dot: "bg-danger", bg: "bg-danger/10" },
};

const agentEmoji: Record<string, string> = {
  "김비서": "👩‍💼",
};

export function AgentStatusCard({ agent }: { agent: Agent }) {
  const status = statusConfig[agent.status];
  const progress =
    agent.totalTasks > 0
      ? Math.round((agent.completedTasks / agent.totalTasks) * 100)
      : 0;
  const emoji = agentEmoji[agent.name] || "🤖";

  return (
    <div className="bg-surface-700/40 rounded-xl p-4 hover:bg-surface-700/60 transition-all group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent-500/15 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            {emoji}
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">{agent.name}</h3>
            <p className="text-xs text-text-muted">{agent.role}</p>
          </div>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full",
            status.bg,
            status.color
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>

      {agent.currentTask && (
        <p className="text-xs text-text-secondary mb-3 truncate bg-surface-900/50 rounded-lg px-3 py-1.5">
          📋 {agent.currentTask}
        </p>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-text-muted">작업 진행률</span>
          <span className="text-[10px] text-text-secondary font-medium">
            {agent.completedTasks}/{agent.totalTasks}
          </span>
        </div>
        <div className="h-1.5 bg-surface-900/60 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
