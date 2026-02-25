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
    { label: "전체", value: counts.total, color: "text-text-primary" },
    { label: "진행 중", value: counts.inProgress, color: "text-warning" },
    { label: "완료", value: counts.completed, color: "text-success" },
    { label: "대기", value: counts.pending, color: "text-text-muted" },
  ];

  return (
    <div>
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        작업 요약
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="bg-surface-800 rounded-lg p-3 border border-surface-700"
          >
            <p className="text-[10px] text-text-muted mb-1">{item.label}</p>
            <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
