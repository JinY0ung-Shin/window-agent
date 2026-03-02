import { useEffect, useState } from "react";
import { useHrStore } from "../../stores/hrStore";
import { AvatarBadge } from "../ui/AvatarBadge";
import { Button } from "../ui/Button";
import { ModalShell } from "../ui/ModalShell";

export function AgentLeaveModal() {
  const { showLeaveModal, selectedAgent, closeLeaveModal, putOnLeave } = useHrStore();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (showLeaveModal) setReason("");
  }, [showLeaveModal]);

  const handleConfirm = async () => {
    if (!selectedAgent) return;
    await putOnLeave(selectedAgent.id, reason);
    closeLeaveModal();
  };

  if (!showLeaveModal || !selectedAgent) return null;

  return (
    <ModalShell
      isOpen={showLeaveModal}
      onClose={closeLeaveModal}
      title="에이전트 휴직"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={closeLeaveModal}>
            취소
          </Button>
          <Button
            variant="ghost"
            className="text-yellow-300 hover:bg-yellow-500/15"
            onClick={handleConfirm}
          >
            휴직 처리
          </Button>
        </div>
      }
    >
      <div className="mb-4 rounded-xl border border-white/[0.08] bg-surface-700/45 p-4">
        <div className="flex items-center gap-3">
          <AvatarBadge name={selectedAgent.name} avatar={selectedAgent.avatar} size="lg" />
          <div>
            <p className="text-sm font-medium text-text-primary">{selectedAgent.name}</p>
            <p className="text-xs text-text-secondary">
              {selectedAgent.role} - {selectedAgent.department}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-yellow-500/25 bg-yellow-500/10 p-4">
        <p className="text-sm text-yellow-300">
          휴직 중에는 작업이 배정되지 않으며 현재 설정이 자동 백업됩니다.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs text-text-muted">휴직 사유</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="휴직 사유를 입력하세요"
          rows={3}
          className="w-full resize-none rounded-lg border border-white/[0.08] bg-surface-700/45 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-500/55 focus:outline-none"
        />
      </div>
    </ModalShell>
  );
}
