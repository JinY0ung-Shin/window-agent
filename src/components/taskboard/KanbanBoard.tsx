import { useEffect } from "react";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { useTaskStore } from "../../stores/taskStore";
import type { TaskStatus } from "../../services/types";
import { KanbanColumn } from "./KanbanColumn";

const columns: { status: TaskStatus; title: string; color: string }[] = [
  { status: "pending", title: "대기중", color: "bg-blue-400" },
  { status: "in_progress", title: "진행중", color: "bg-yellow-400" },
  { status: "completed", title: "완료", color: "bg-green-400" },
];

export function KanbanBoard() {
  const {
    fetchTasks,
    getTasksByStatus,
    moveTask,
    openCreateModal,
    loading,
  } = useTaskStore();

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
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        로딩 중...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">작업 보드</h2>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 새 작업
        </button>
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-3 gap-4">
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
    </div>
  );
}
