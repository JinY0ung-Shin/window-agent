import { useEffect } from "react";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { useTaskStore } from "../../stores/taskStore";
import type { TaskStatus } from "../../services/types";
import { KanbanColumn } from "./KanbanColumn";

const columns: { status: TaskStatus; title: string; color: string }[] = [
  { status: "pending", title: "대기", color: "bg-slate-400" },
  { status: "in_progress", title: "진행", color: "bg-amber-400" },
  { status: "completed", title: "완료", color: "bg-emerald-400" },
];

export function KanbanBoard() {
  const { fetchTasks, getTasksByStatus, moveTask, loading } = useTaskStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;

    if (columns.some((col) => col.status === newStatus)) {
      moveTask(taskId, newStatus);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        로딩 중...
      </div>
    );
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {columns.map((col) => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            title={col.title}
            tasks={getTasksByStatus(col.status)}
            color={col.color}
          />
        ))}
      </div>
    </DndContext>
  );
}
