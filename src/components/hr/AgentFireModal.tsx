import { useEffect } from "react";
import { useHrStore } from "../../stores/hrStore";

const agentEmoji: Record<string, string> = {
  "김비서": "👩‍💼",
  "박개발": "💻",
  "이분석": "📊",
  "최기획": "📝",
  "정조사": "🔍",
  "한디자": "🎨",
  "강관리": "📁",
  "윤자동": "🔧",
};

export function AgentFireModal() {
  const {
    showFireModal,
    selectedAgent,
    closeFireModal,
    fireAgent,
  } = useHrStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFireModal();
    };
    if (showFireModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showFireModal, closeFireModal]);

  const handleConfirm = async () => {
    if (!selectedAgent) return;
    await fireAgent(selectedAgent.id);
    closeFireModal();
  };

  if (!showFireModal || !selectedAgent) return null;

  const emoji = agentEmoji[selectedAgent.name] || selectedAgent.avatar || "🤖";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeFireModal}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          에이전트 해고
        </h2>

        <div className="bg-surface-700/40 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{emoji}</span>
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

        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-400">
            이 에이전트를 해고하시겠습니까? 해고된 에이전트는 더 이상 작업을
            수행할 수 없습니다.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={closeFireModal}
            className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-text-primary text-sm rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium text-sm rounded-lg transition-colors"
          >
            해고하기
          </button>
        </div>
      </div>
    </div>
  );
}
