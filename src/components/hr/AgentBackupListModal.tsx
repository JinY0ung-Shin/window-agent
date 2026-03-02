import { useEffect, useState } from "react";
import { useHrStore } from "../../stores/hrStore";
import type { AgentBackup } from "../../services/types";
import {
  getAgentBackups,
  rehireFromBackup as rehireFromBackupCmd,
} from "../../services/tauriCommands";

export function AgentBackupListModal() {
  const { showBackupListModal, selectedAgent, closeBackupListModal, fetchAgents } =
    useHrStore();

  const [backups, setBackups] = useState<AgentBackup[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (showBackupListModal && selectedAgent) {
      setLoading(true);
      getAgentBackups(selectedAgent.id).then((data) => {
        setBackups(data);
        setLoading(false);
      });
    }
  }, [showBackupListModal, selectedAgent]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBackupListModal();
    };
    if (showBackupListModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showBackupListModal, closeBackupListModal]);

  const handleRehire = async (backupId: string) => {
    await rehireFromBackupCmd(backupId);
    await fetchAgents();
    closeBackupListModal();
  };

  if (!showBackupListModal || !selectedAgent) return null;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeBackupListModal}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          백업 목록 - {selectedAgent.name}
        </h2>

        {loading ? (
          <div className="text-center py-8 text-text-muted text-sm">
            로딩 중...
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm">
            백업 데이터가 없습니다.
          </div>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className="bg-surface-700/40 rounded-xl p-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-xs text-text-primary font-medium">
                    {backup.reason}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {formatDate(backup.backedUpAt)}
                  </p>
                  {backup.restoredAt && (
                    <p className="text-[11px] text-green-400 mt-0.5">
                      복원됨: {formatDate(backup.restoredAt)}
                    </p>
                  )}
                </div>
                {!backup.restoredAt && (
                  <button
                    onClick={() => handleRehire(backup.id)}
                    className="px-3 py-1 bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 text-xs rounded-lg transition-colors shrink-0"
                  >
                    재채용
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end mt-6">
          <button
            onClick={closeBackupListModal}
            className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-text-primary text-sm rounded-lg transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
