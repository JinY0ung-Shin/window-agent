import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTaskStore } from "../../stores/taskStore";
import { useHrStore } from "../../stores/hrStore";
import type { Task, TaskPriority } from "../../services/types";
import { formatDate } from "../../lib/utils";

const agentEmoji: Record<string, string> = {
  "김비서": "👩‍💼",
  "박개발": "💻",
  "이분석": "📊",
  "최기획": "📝",
  "정조사": "🔍",
  "한디자": "🎨",
  "강관리": "📁",
  "윤자동": "🔧",
};

const priorityConfig: Record<TaskPriority, { label: string; className: string }> = {
  urgent: { label: "긴급", className: "bg-red-500/20 text-red-400" },
  high: { label: "높음", className: "bg-orange-500/20 text-orange-400" },
  medium: { label: "보통", className: "bg-yellow-500/20 text-yellow-400" },
  low: { label: "낮음", className: "bg-blue-500/20 text-blue-400" },
};

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const { setSelectedTask, openDetailModal } = useTaskStore();
  const { agents } = useHrStore();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const assignee = task.assigneeId
    ? agents.find((a) => a.id === task.assigneeId)
    : null;

  const priority = priorityConfig[task.priority];

  const handleClick = () => {
    setSelectedTask(task);
    openDetailModal();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className="bg-surface-700/40 rounded-xl p-3 cursor-grab active:cursor-grabbing hover:bg-surface-700/60 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-medium text-text-primary leading-tight">
          {task.title}
        </h4>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${priority.className}`}
        >
          {priority.label}
        </span>
      </div>

      <div className="flex items-center justify-between">
        {assignee ? (
          <div className="flex items-center gap-1.5">
            <span className="text-sm">
              {agentEmoji[assignee.name] || assignee.avatar || "🤖"}
            </span>
            <span className="text-xs text-text-secondary">
              {assignee.name}
            </span>
          </div>
        ) : (
          <span className="text-xs text-text-muted">미배정</span>
        )}
        <span className="text-[11px] text-text-muted">
          {formatDate(task.createdAt)}
        </span>
      </div>
    </div>
  );
}
