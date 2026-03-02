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
  }[] = [
    { label: "전체", value: counts.total, color: "text-text-primary", icon: "tasks" },
    { label: "진행 중", value: counts.inProgress, color: "text-warning", icon: "clock" },
    { label: "완료", value: counts.completed, color: "text-success", icon: "trendUp" },
    { label: "대기", value: counts.pending, color: "text-text-muted", icon: "calendar" },
  ];

  return (
    <SurfaceCard>
      <h2 className="section-title">
        <AppIcon name="trendUp" size={15} className="text-accent-400" />
        <span>작업 요약</span>
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-white/[0.08] bg-surface-700/45 p-3 transition-colors hover:bg-surface-700/65"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <AppIcon name={item.icon} size={13} className="text-text-secondary" />
              <p className="text-xs text-text-secondary">{item.label}</p>
            </div>
            <p className={`text-2xl font-semibold ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}
