import { useAgentStore } from "../../stores/agentStore";
import { AppIcon, type AppIconName } from "../ui/AppIcon";
import { SurfaceCard } from "../ui/SurfaceCard";

export function TaskSummary() {
  const tasks = useAgentStore((s) => s.tasks);

  const counts = {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    pending: tasks.filter((t) => t.status === "pending").length,
  };

  const items: {
    label: string;
    value: number;
    color: string;
    icon: AppIconName;
    glow: string;
  }[] = [
      { label: "전체", value: counts.total, color: "text-text-primary", icon: "tasks", glow: "from-accent-500/15 to-transparent" },
      { label: "진행 중", value: counts.inProgress, color: "text-warning", icon: "clock", glow: "from-warning/10 to-transparent" },
      { label: "완료", value: counts.completed, color: "text-success", icon: "trendUp", glow: "from-success/10 to-transparent" },
      { label: "대기", value: counts.pending, color: "text-text-muted", icon: "calendar", glow: "from-surface-500/15 to-transparent" },
    ];

  return (
    <SurfaceCard>
      <h2 className="section-title">
        <AppIcon name="trendUp" size={15} className="text-accent-400 drop-shadow-[0_0_4px_rgba(167,139,250,0.3)]" />
        <span>작업 요약</span>
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-surface-700/30 p-6 backdrop-blur-sm transition-all duration-300 hover:border-accent-500/15 hover:bg-surface-700/50"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${item.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
            <div className="relative">
              <div className="mb-2 flex items-center gap-2">
                <AppIcon name={item.icon} size={13} className="text-text-secondary" />
                <p className="text-xs text-text-secondary">{item.label}</p>
              </div>
              <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            </div>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}
