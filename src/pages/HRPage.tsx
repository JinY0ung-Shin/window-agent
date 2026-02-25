import { useEffect } from "react";
import { useHrStore } from "../stores/hrStore";
import { AgentTable } from "../components/hr/AgentTable";
import { AgentCreateModal } from "../components/hr/AgentCreateModal";
import { AgentEditModal } from "../components/hr/AgentEditModal";
import { AgentFireModal } from "../components/hr/AgentFireModal";
import { AgentProfileCard } from "../components/hr/AgentProfileCard";

export function HRPage() {
  const {
    fetchAgents,
    fetchDepartments,
    showCreateModal,
    showEditModal,
    showFireModal,
    showProfileCard,
    openCreateModal,
  } = useHrStore();

  useEffect(() => {
    fetchAgents();
    fetchDepartments();
  }, [fetchAgents, fetchDepartments]);

  return (
    <div className="h-full p-6 overflow-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
            👤 인사관리
          </h1>
          <p className="text-xs text-text-muted mt-1">AI 에이전트를 채용하고 관리하세요</p>
        </div>
        <button
          onClick={openCreateModal}
          className="bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + 에이전트 채용
        </button>
      </div>

      {/* Agent Table */}
      <AgentTable />

      {/* Modals */}
      {showCreateModal && <AgentCreateModal />}
      {showEditModal && <AgentEditModal />}
      {showFireModal && <AgentFireModal />}
      {showProfileCard && <AgentProfileCard />}
    </div>
  );
}
