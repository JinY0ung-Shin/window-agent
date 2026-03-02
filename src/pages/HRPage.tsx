import { useEffect } from "react";
import { useHrStore } from "../stores/hrStore";
import { AgentTable } from "../components/hr/AgentTable";
import { AgentCreateModal } from "../components/hr/AgentCreateModal";
import { AgentEditModal } from "../components/hr/AgentEditModal";
import { AgentFireModal } from "../components/hr/AgentFireModal";
import { AgentProfileCard } from "../components/hr/AgentProfileCard";
import { PageShell } from "../components/ui/PageShell";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AppIcon } from "../components/ui/AppIcon";

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
    <PageShell className="h-full overflow-auto">
      <PageHeader
        icon="users"
        title="인사관리"
        description="AI 에이전트의 채용, 편집, 상태 관리를 진행합니다."
        actions={
          <Button
            onClick={openCreateModal}
            leadingIcon={<AppIcon name="plus" size={15} />}
          >
            에이전트 채용
          </Button>
        }
      />

      <AgentTable />

      {showCreateModal && <AgentCreateModal />}
      {showEditModal && <AgentEditModal />}
      {showFireModal && <AgentFireModal />}
      {showProfileCard && <AgentProfileCard />}
    </PageShell>
  );
}
