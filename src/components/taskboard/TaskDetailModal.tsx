import { useState, useEffect } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useHrStore } from "../../stores/hrStore";
import type { TaskPriority, TaskStatus } from "../../services/types";
import { formatDate } from "../../lib/utils";
import { ConfirmationModal } from "../common/ConfirmationModal";
import { AvatarBadge } from "../ui/AvatarBadge";

const priorityConfig: Record<TaskPriority, { label: string; className: string }> = {
  urgent: { label: "긴급", className: "bg-red-500/20 text-red-400" },
  high: { label: "높음", className: "bg-orange-500/20 text-orange-400" },
  medium: { label: "보통", className: "bg-sky-500/20 text-sky-400" },
  low: { label: "낮음", className: "bg-blue-500/20 text-blue-400" },
};

const statusConfig: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: "대기중", className: "bg-blue-500/20 text-blue-400" },
  in_progress: { label: "진행중", className: "bg-yellow-500/20 text-yellow-400" },
  completed: { label: "완료", className: "bg-green-500/20 text-green-400" },
  failed: { label: "실패", className: "bg-red-500/20 text-red-400" },
};

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
  { value: "urgent", label: "긴급" },
];

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "pending", label: "대기중" },
  { value: "in_progress", label: "진행중" },
  { value: "completed", label: "완료" },
  { value: "failed", label: "실패" },
];

const inputClass =
  "w-full bg-surface-900 border border-white/[0.12] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/20 transition-colors";
const labelClass = "block text-xs font-medium text-text-secondary mb-1.5";

export function TaskDetailModal() {
  const {
    showDetailModal,
    selectedTask,
    closeDetailModal,
    updateTask,
    deleteTask,
  } = useTaskStore();
  const { agents } = useHrStore();

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("pending");

  useEffect(() => {
    if (selectedTask && showDetailModal) {
      setTitle(selectedTask.title);
      setDescription(selectedTask.description);
      setAssigneeId(selectedTask.assigneeId || "");
      setPriority(selectedTask.priority);
      setStatus(selectedTask.status);
      setIsEditing(false);
    }
  }, [selectedTask, showDetailModal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else {
          closeDetailModal();
        }
      }
    };
    if (showDetailModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDetailModal, showDeleteConfirm, closeDetailModal]);

  const handleSave = async () => {
    if (!selectedTask) return;
    await updateTask(selectedTask.id, {
      title,
      description,
      assigneeId: assigneeId || undefined,
      priority,
      status,
    });
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!selectedTask) return;
    await deleteTask(selectedTask.id);
    setShowDeleteConfirm(false);
    closeDetailModal();
  };

  if (!showDetailModal || !selectedTask) return null;

  const assignee = selectedTask.assigneeId
    ? agents.find((a) => a.id === selectedTask.assigneeId)
    : null;

  const taskPriority = priorityConfig[selectedTask.priority];
  const taskStatus = statusConfig[selectedTask.status];
  const activeAgents = agents.filter((a) => a.isActive);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={closeDetailModal}
        />
        <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-auto">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              {!isEditing && (
                <>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${taskStatus.className}`}
                  >
                    {taskStatus.label}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${taskPriority.className}`}
                  >
                    {taskPriority.label}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isEditing ? (
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-text-primary text-xs rounded-lg transition-colors"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs rounded-lg transition-colors"
                  >
                    삭제
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-text-primary text-xs rounded-lg transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    저장
                  </button>
                </>
              )}
              <button
                onClick={closeDetailModal}
                className="text-text-muted hover:text-text-primary transition-colors ml-1"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>제목</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>설명</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={`${inputClass} resize-none min-h-[80px]`}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>상태</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className={inputClass}
                  >
                    {statusOptions.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>우선순위</label>
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as TaskPriority)
                    }
                    className={inputClass}
                  >
                    {priorityOptions.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
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
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-text-primary">
                {selectedTask.title}
              </h2>

              <div className="bg-surface-700/40 rounded-xl p-4">
                <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                  설명
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {selectedTask.description || "설명 없음"}
                </p>
              </div>

              <div className="bg-surface-700/40 rounded-xl p-4">
                <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                  상세 정보
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">담당자</span>
                    {assignee ? (
                      <span className="text-text-primary flex items-center gap-1.5">
                        <AvatarBadge name={assignee.name} avatar={assignee.avatar} size="sm" />
                        {assignee.name}
                      </span>
                    ) : (
                      <span className="text-text-muted">미배정</span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">생성일</span>
                    <span className="text-text-primary">
                      {formatDate(selectedTask.createdAt)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">수정일</span>
                    <span className="text-text-primary">
                      {formatDate(selectedTask.updatedAt)}
                    </span>
                  </div>
                  {selectedTask.completedAt && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary">완료일</span>
                      <span className="text-text-primary">
                        {formatDate(selectedTask.completedAt)}
                      </span>
                    </div>
                  )}
                  {selectedTask.creator && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary">생성자</span>
                      <span className="text-text-primary">
                        {selectedTask.creator}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="작업 삭제"
        message="이 작업을 삭제하시겠습니까? 이 작업은 복구할 수 없습니다."
        confirmText="삭제"
        confirmVariant="danger"
      />
    </>
  );
}
