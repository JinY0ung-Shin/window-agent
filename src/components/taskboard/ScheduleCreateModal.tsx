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

export function ScheduleCreateModal() {
  const { createScheduledTask, closeCreateModal } = useScheduleStore();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !cronExpression.trim()) return;
    setSubmitting(true);
    try {
      await createScheduledTask({
        title: title.trim(),
        description: description.trim(),
        cronExpression: cronExpression.trim(),
        assignee: assignee.trim() || undefined,
        priority,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold text-text-primary">새 스케줄 등록</h2>
          <button
            onClick={closeCreateModal}
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
              placeholder="스케줄 제목을 입력하세요"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500 resize-none"
              rows={3}
              placeholder="스케줄 설명을 입력하세요"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Cron 표현식 *</label>
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-accent-500 mb-2"
              placeholder="0 9 * * *"
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
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={closeCreateModal}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !cronExpression.trim() || submitting}
            className="bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {submitting ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
