import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task, TaskStatus } from "../../services/types";
import { TaskCard } from "./TaskCard";
import { EmptyState } from "../ui/EmptyState";

interface KanbanColumnProps {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  color: string;
}

export function KanbanColumn({ status, title, tasks, color }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[420px] flex-col rounded-2xl border bg-surface-800/78 p-3.5 shadow-[0_10px_30px_rgba(2,6,15,0.24)] transition-colors ${
        isOver
          ? "border-accent-500/55 bg-accent-500/[0.06]"
          : "border-white/[0.08]"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${color}`} />
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <span className="ml-auto rounded-full bg-surface-600 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
          {tasks.length}
        </span>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 min-h-[120px]">
          <div className="space-y-2.5">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>

          {tasks.length === 0 && (
            <EmptyState
              icon="tasks"
              title="작업 없음"
              className="mt-2 rounded-xl border-2 border-dashed border-white/[0.08] py-10"
            />
          )}
        </div>
      </SortableContext>
    </section>
  );
}
