import { useEffect } from "react";
import { useAgentStore } from "../stores/agentStore";
import { AgentStatusList } from "../components/dashboard/AgentStatusList";
import { TaskSummary } from "../components/dashboard/TaskSummary";
import { RecentTasks } from "../components/dashboard/RecentTasks";
import { QuickCommand } from "../components/dashboard/QuickCommand";
import { CostOverview } from "../components/dashboard/CostOverview";
import { PageHeader } from "../components/ui/PageHeader";
import { PageShell } from "../components/ui/PageShell";

export function DashboardPage() {
  const { fetchAgents, fetchTasks } = useAgentStore();

  useEffect(() => {
    fetchAgents();
    fetchTasks();
  }, [fetchAgents, fetchTasks]);

  return (
    <PageShell>
      <PageHeader
        icon="dashboard"
        title="대시보드"
        description="에이전트 상태, 작업 흐름, 비용 지표를 한 화면에서 확인합니다."
      />

      <div className="mb-4">
        <QuickCommand />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <AgentStatusList />
          <TaskSummary />
        </div>
        <div className="space-y-4">
          <RecentTasks />
          <CostOverview />
        </div>
      </div>
    </PageShell>
  );
}
