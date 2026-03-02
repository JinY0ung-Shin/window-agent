import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTaskStore } from "../../stores/taskStore";
import { useHrStore } from "../../stores/hrStore";
import type { Task, TaskPriority } from "../../services/types";
import { formatDate } from "../../lib/utils";
import { AvatarBadge } from "../ui/AvatarBadge";

const priorityConfig: Record<TaskPriority, { label: string; className: string }> = {
  urgent: { label: "긴급", className: "bg-red-500/20 text-red-400" },
  high: { label: "높음", className: "bg-orange-500/20 text-orange-400" },
  medium: { label: "보통", className: "bg-sky-500/20 text-sky-400" },
  low: { label: "낮음", className: "bg-blue-500/20 text-blue-400" },
};

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const { setSelectedTask, openDetailModal } = useTaskStore();
  const { agents } = useHrStore();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const assignee = task.assigneeId ? agents.find((a) => a.id === task.assigneeId) : null;
  const priority = priorityConfig[task.priority];

  const handleClick = () => {
    setSelectedTask(task);
    openDetailModal();
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className="cursor-grab rounded-xl border border-white/[0.08] bg-surface-700/65 p-3 shadow-md transition-all hover:border-white/[0.18] hover:bg-surface-700/82 active:cursor-grabbing"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-tight text-text-primary">{task.title}</h4>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${priority.className}`}
        >
          {priority.label}
        </span>
      </div>

      <div className="flex items-center justify-between">
        {assignee ? (
          <div className="flex items-center gap-1.5">
            <AvatarBadge name={assignee.name} avatar={assignee.avatar} size="sm" />
            <span className="text-xs text-text-secondary">{assignee.name}</span>
          </div>
        ) : (
          <span className="text-xs text-text-muted">미배정</span>
        )}
        <span className="text-[11px] text-text-muted">{formatDate(task.createdAt)}</span>
      </div>
    </article>
  );
}
