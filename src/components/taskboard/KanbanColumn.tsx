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
      className={`flex min-h-[420px] flex-col rounded-2xl border p-3.5 transition-all duration-300 backdrop-blur-sm ${isOver
          ? "border-accent-500/40 bg-accent-500/[0.06] shadow-[0_0_24px_rgba(124,58,237,0.1)]"
          : "border-white/[0.06] bg-surface-800/50"
        }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${color} shadow-[0_0_6px_currentColor]`} />
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <span className="ml-auto rounded-full bg-gradient-to-r from-accent-500/12 to-cyan-500/8 px-2 py-0.5 text-[11px] font-medium text-accent-400">
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
              className="mt-2 rounded-xl border-2 border-dashed border-white/[0.06] py-10"
            />
          )}
        </div>
      </SortableContext>
    </section>
  );
}
