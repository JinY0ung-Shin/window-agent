import { useState, useEffect } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useHrStore } from "../../stores/hrStore";
import type { TaskPriority, CreateTaskRequest } from "../../services/types";

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
  { value: "urgent", label: "긴급" },
];

const inputClass =
  "w-full bg-surface-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/50 transition-colors";
const labelClass = "block text-xs font-medium text-text-secondary mb-1.5";

export function TaskCreateModal() {
  const { showCreateModal, tasks, closeCreateModal, createTask } =
    useTaskStore();
  const { agents } = useHrStore();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [parentTaskId, setParentTaskId] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCreateModal();
    };
    if (showCreateModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showCreateModal, closeCreateModal]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setPriority("medium");
    setParentTaskId("");
  };

  const handleClose = () => {
    resetForm();
    closeCreateModal();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const request: CreateTaskRequest = {
      title,
      description,
      priority,
      ...(assigneeId ? { assigneeId } : {}),
      ...(parentTaskId ? { parentTaskId } : {}),
    };
    await createTask(request);
    handleClose();
  };

  if (!showCreateModal) return null;

  const activeAgents = agents.filter((a) => a.isActive);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-auto">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          새 작업 생성
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="작업 제목"
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="작업 설명"
              className={`${inputClass} resize-none min-h-[80px]`}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>담당자</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={inputClass}
              >
                <option value="">미배정</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} - {agent.role}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>우선순위</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className={inputClass}
              >
                {priorityOptions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>상위 작업 (선택사항)</label>
            <select
              value={parentTaskId}
              onChange={(e) => setParentTaskId(e.target.value)}
              className={inputClass}
            >
              <option value="">없음</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-text-primary text-sm rounded-lg transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              생성
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
