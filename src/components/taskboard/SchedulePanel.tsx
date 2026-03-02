import { useEffect } from "react";
import { useScheduleStore } from "../../stores/scheduleStore";
import { ScheduleCreateModal } from "./ScheduleCreateModal";
import { ScheduleEditModal } from "./ScheduleEditModal";

const cronToReadable: Record<string, string> = {
  "0 9 * * *": "매일 오전 9시",
  "0 9 * * 1-5": "평일 오전 9시",
  "0 0 * * 1": "매주 월요일 자정",
  "0 0 1 * *": "매월 1일 자정",
  "0 18 * * 5": "매주 금요일 오후 6시",
  "*/30 * * * *": "30분마다",
  "0 */2 * * *": "2시간마다",
};

function formatCron(expr: string): string {
  return cronToReadable[expr] || expr;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

const priorityColors: Record<string, string> = {
  urgent: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-green-400",
};

const priorityLabels: Record<string, string> = {
  urgent: "긴급",
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export function SchedulePanel() {
  const {
    scheduledTasks,
    loading,
    showCreateModal,
    showEditModal,
    fetchScheduledTasks,
    openCreateModal,
    openEditModal,
    updateScheduledTask,
    triggerScheduledTask,
  } = useScheduleStore();

  useEffect(() => {
    fetchScheduledTasks();
  }, [fetchScheduledTasks]);

  const handleToggleActive = async (taskId: string, currentActive: boolean) => {
    await updateScheduledTask(taskId, { isActive: !currentActive });
  };

  const handleTrigger = async (taskId: string) => {
    await triggerScheduledTask(taskId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        로딩 중...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">
          등록된 스케줄: {scheduledTasks.length}개
        </p>
        <button
          onClick={openCreateModal}
          className="bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + 새 스케줄
        </button>
      </div>

      {scheduledTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-text-muted">
          <span className="text-3xl mb-2">&#x23F0;</span>
          <p className="text-sm">등록된 스케줄이 없습니다</p>
          <p className="text-xs mt-1">새 스케줄을 추가하여 자동으로 업무를 생성하세요</p>
        </div>
      ) : (
        <div className="bg-bg-secondary rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-xs uppercase">
                <th className="text-left px-4 py-3">제목</th>
                <th className="text-left px-4 py-3">스케줄</th>
                <th className="text-left px-4 py-3">담당자</th>
                <th className="text-left px-4 py-3">우선순위</th>
                <th className="text-center px-4 py-3">활성</th>
                <th className="text-left px-4 py-3">마지막 실행</th>
                <th className="text-left px-4 py-3">다음 실행</th>
                <th className="text-center px-4 py-3">작업</th>
              </tr>
            </thead>
            <tbody>
              {scheduledTasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-border/50 hover:bg-bg-tertiary/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEditModal(task)}
                      className="text-text-primary hover:text-accent-400 transition-colors text-left"
                    >
                      {task.title}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-text-muted font-mono text-xs">
                    {formatCron(task.cronExpression)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {task.assignee || "-"}
                  </td>
                  <td className={`px-4 py-3 ${priorityColors[task.priority] || "text-text-muted"}`}>
                    {priorityLabels[task.priority] || task.priority}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggleActive(task.id, task.isActive)}
                      className={`w-10 h-5 rounded-full relative transition-colors ${
                        task.isActive ? "bg-green-500" : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                          task.isActive ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {formatDate(task.lastRunAt)}
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {task.isActive ? formatDate(task.nextRunAt) : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleTrigger(task.id)}
                      className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
                      title="즉시 실행"
                    >
                      실행
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && <ScheduleCreateModal />}
      {showEditModal && <ScheduleEditModal />}
    </div>
  );
}
