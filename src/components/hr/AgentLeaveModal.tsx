import { useEffect, useState } from "react";
import { useHrStore } from "../../stores/hrStore";

export function AgentLeaveModal() {
  const { showLeaveModal, selectedAgent, closeLeaveModal, putOnLeave } =
    useHrStore();

  const [reason, setReason] = useState("");

  useEffect(() => {
    if (showLeaveModal) setReason("");
  }, [showLeaveModal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLeaveModal();
    };
    if (showLeaveModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showLeaveModal, closeLeaveModal]);

  const handleConfirm = async () => {
    if (!selectedAgent) return;
    await putOnLeave(selectedAgent.id, reason);
    closeLeaveModal();
  };

  if (!showLeaveModal || !selectedAgent) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeLeaveModal}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          에이전트 휴직
        </h2>

        <div className="bg-surface-700/40 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{selectedAgent.avatar || "🤖"}</span>
            <div>
              <p className="text-sm font-medium text-text-primary">
                {selectedAgent.name}
              </p>
              <p className="text-xs text-text-secondary">
                {selectedAgent.role} - {selectedAgent.department}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-4">
          <p className="text-sm text-yellow-400">
            이 에이전트를 휴직 처리하시겠습니까? 휴직 중에는 작업이 배정되지
            않으며, 현재 설정이 자동으로 백업됩니다.
          </p>
        </div>

        <div className="mb-6">
          <label className="block text-xs text-text-muted mb-1.5">
            휴직 사유
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="휴직 사유를 입력하세요"
            rows={3}
            className="w-full px-3 py-2 bg-surface-700/40 border border-white/[0.06] rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/50 resize-none"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={closeLeaveModal}
            className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-text-primary text-sm rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 text-sm rounded-lg transition-colors"
          >
            휴직 처리
          </button>
        </div>
      </div>
    </div>
  );
}
