import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Task, TaskStatus } from "../../services/types";
import { TaskCard } from "./TaskCard";

interface KanbanColumnProps {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  color: string;
}

export function KanbanColumn({ status, title, tasks, color }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`bg-surface-700 border border-white/[0.10] rounded-2xl p-4 flex flex-col shadow-lg transition-colors ${
        isOver ? "border-accent-500/60 bg-accent-500/[0.06] ring-1 ring-accent-500/30" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <span className="ml-auto bg-surface-500 text-text-secondary text-[11px] font-medium px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>

      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 min-h-[120px]">
          <div className="space-y-2.5">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>

          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-white/[0.08] rounded-xl text-text-muted gap-2 mt-1">
              <span className="text-xs">작업 없음</span>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
