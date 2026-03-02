import { useAgentStore } from "../../stores/agentStore";

export function TaskSummary() {
  const tasks = useAgentStore((s) => s.tasks);

  const counts = {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    pending: tasks.filter((t) => t.status === "pending").length,
  };

  const items = [
    { label: "전체", value: counts.total, color: "text-text-primary", emoji: "📋" },
    { label: "진행 중", value: counts.inProgress, color: "text-warning", emoji: "🔄" },
    { label: "완료", value: counts.completed, color: "text-success", emoji: "✅" },
    { label: "대기", value: counts.pending, color: "text-text-muted", emoji: "⏳" },
  ];

  return (
    <div className="card">
      <h2 className="section-title">
        <span>📈</span>
        <span>작업 요약</span>
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="bg-surface-700/40 rounded-xl p-3.5 hover:bg-surface-700/60 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm">{item.emoji}</span>
              <p className="text-xs text-text-secondary">{item.label}</p>
            </div>
            <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
