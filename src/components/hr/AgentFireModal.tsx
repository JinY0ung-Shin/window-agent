import { useHrStore } from "../../stores/hrStore";
import { AvatarBadge } from "../ui/AvatarBadge";
import { Button } from "../ui/Button";
import { ModalShell } from "../ui/ModalShell";

export function AgentFireModal() {
  const { showFireModal, selectedAgent, closeFireModal, fireAgent } = useHrStore();

  const handleConfirm = async () => {
    if (!selectedAgent) return;
    await fireAgent(selectedAgent.id);
    closeFireModal();
  };

  if (!showFireModal || !selectedAgent) return null;

  return (
    <ModalShell
      isOpen={showFireModal}
      onClose={closeFireModal}
      title="에이전트 해고"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={closeFireModal}>
            취소
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            해고하기
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

      <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4">
        <p className="text-sm text-red-300">
          이 에이전트를 해고하면 이후 작업이 중단됩니다. 진행할까요?
        </p>
      </div>
    </ModalShell>
  );
}
