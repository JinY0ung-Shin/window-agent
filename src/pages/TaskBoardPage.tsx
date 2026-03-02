import { useEffect, useState } from "react";
import { useTaskStore } from "../stores/taskStore";
import { KanbanBoard } from "../components/taskboard/KanbanBoard";
import { TaskCreateModal } from "../components/taskboard/TaskCreateModal";
import { TaskDetailModal } from "../components/taskboard/TaskDetailModal";
import { SchedulePanel } from "../components/taskboard/SchedulePanel";

type TabType = "kanban" | "schedule";

export function TaskBoardPage() {
  const {
    fetchTasks,
    showCreateModal,
    showDetailModal,
    openCreateModal,
  } = useTaskStore();

  const [activeTab, setActiveTab] = useState<TabType>("kanban");

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            {activeTab === "kanban" ? "\u{1F4CB}" : "\u{23F0}"} 업무보드
          </h1>
          <p className="text-xs text-text-muted mt-1">
            {activeTab === "kanban"
              ? "에이전트 업무를 칸반 보드로 관리하세요"
              : "자동 스케줄링으로 반복 업무를 관리하세요"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tab Toggle */}
          <div className="flex bg-surface-700 rounded-lg p-0.5 border border-white/[0.06]">
            <button
              onClick={() => setActiveTab("kanban")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                activeTab === "kanban"
                  ? "bg-accent-500 text-white"
                  : "text-text-muted hover:text-text-primary hover:bg-white/[0.05]"
              }`}
            >
              칸반
            </button>
            <button
              onClick={() => setActiveTab("schedule")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                activeTab === "schedule"
                  ? "bg-accent-500 text-white"
                  : "text-text-muted hover:text-text-primary hover:bg-white/[0.05]"
              }`}
            >
              스케줄
            </button>
          </div>
          {activeTab === "kanban" && (
            <button
              onClick={openCreateModal}
              className="bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + 업무 추가
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {activeTab === "kanban" ? (
        <>
          <KanbanBoard />
          {showCreateModal && <TaskCreateModal />}
          {showDetailModal && <TaskDetailModal />}
        </>
      ) : (
        <SchedulePanel />
      )}
    </div>
  );
}
