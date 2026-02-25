import { useEffect } from "react";
import { useTaskStore } from "../stores/taskStore";
import { KanbanBoard } from "../components/taskboard/KanbanBoard";
import { TaskCreateModal } from "../components/taskboard/TaskCreateModal";
import { TaskDetailModal } from "../components/taskboard/TaskDetailModal";

export function TaskBoardPage() {
  const {
    fetchTasks,
    showCreateModal,
    showDetailModal,
    openCreateModal,
  } = useTaskStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="h-full p-6 overflow-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
            📋 업무보드
          </h1>
          <p className="text-xs text-text-muted mt-1">에이전트 업무를 칸반 보드로 관리하세요</p>
        </div>
        <button
          onClick={openCreateModal}
          className="bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + 업무 추가
        </button>
      </div>

      {/* Kanban Board */}
      <KanbanBoard />

      {/* Modals */}
      {showCreateModal && <TaskCreateModal />}
      {showDetailModal && <TaskDetailModal />}
    </div>
  );
}
