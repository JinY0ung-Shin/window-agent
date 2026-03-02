import { useState } from "react";
import { useScheduleStore } from "../../stores/scheduleStore";
import type { TaskPriority } from "../../services/types";

const cronPresets = [
  { label: "매일 오전 9시", value: "0 9 * * *" },
  { label: "평일 오전 9시", value: "0 9 * * 1-5" },
  { label: "매주 월요일", value: "0 0 * * 1" },
  { label: "매월 1일", value: "0 0 1 * *" },
  { label: "금요일 오후 6시", value: "0 18 * * 5" },
  { label: "30분마다", value: "*/30 * * * *" },
  { label: "2시간마다", value: "0 */2 * * *" },
];

export function ScheduleEditModal() {
  const { selectedSchedule, updateScheduledTask, deleteScheduledTask, closeEditModal } =
    useScheduleStore();

  const [title, setTitle] = useState(selectedSchedule?.title || "");
  const [description, setDescription] = useState(selectedSchedule?.description || "");
  const [cronExpression, setCronExpression] = useState(selectedSchedule?.cronExpression || "");
  const [assignee, setAssignee] = useState(selectedSchedule?.assignee || "");
  const [priority, setPriority] = useState<TaskPriority>(
    (selectedSchedule?.priority as TaskPriority) || "medium"
  );
  const [isActive, setIsActive] = useState(selectedSchedule?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!selectedSchedule) return null;

  const handleSubmit = async () => {
    if (!title.trim() || !cronExpression.trim()) return;
    setSubmitting(true);
    try {
      await updateScheduledTask(selectedSchedule.id, {
        title: title.trim(),
        description: description.trim(),
        cronExpression: cronExpression.trim(),
        assignee: assignee.trim() || undefined,
        priority,
        isActive,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteScheduledTask(selectedSchedule.id);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold text-text-primary">스케줄 수정</h2>
          <button
            onClick={closeEditModal}
            className="text-text-muted hover:text-text-primary transition-colors text-lg"
          >
            &#x2715;
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">제목 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500 resize-none"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Cron 표현식 *</label>
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-accent-500 mb-2"
            />
            <div className="flex flex-wrap gap-1.5">
              {cronPresets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setCronExpression(preset.value)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    cronExpression === preset.value
                      ? "bg-accent-500 border-accent-500 text-white"
                      : "bg-bg-tertiary border-border text-text-muted hover:text-text-primary hover:border-accent-500"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">담당자</label>
              <input
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500"
                placeholder="에이전트 ID"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">우선순위</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500"
              >
                <option value="low">낮음</option>
                <option value="medium">보통</option>
                <option value="high">높음</option>
                <option value="urgent">긴급</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-text-muted">활성 상태</label>
            <button
              onClick={() => setIsActive(!isActive)}
              className={`w-10 h-5 rounded-full relative transition-colors ${
                isActive ? "bg-green-500" : "bg-gray-600"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  isActive ? "left-5" : "left-0.5"
                }`}
              />
            </button>
            <span className="text-xs text-text-muted">
              {isActive ? "활성" : "비활성"}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <button
            onClick={handleDelete}
            className={`text-sm px-3 py-1.5 rounded transition-colors ${
              confirmDelete
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "text-red-400 hover:text-red-300"
            }`}
          >
            {confirmDelete ? "정말 삭제?" : "삭제"}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={closeEditModal}
              className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim() || !cronExpression.trim() || submitting}
              className="bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {submitting ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
