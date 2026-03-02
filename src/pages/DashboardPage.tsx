import { useEffect } from "react";
import { useAgentStore } from "../stores/agentStore";
import { AgentStatusList } from "../components/dashboard/AgentStatusList";
import { TaskSummary } from "../components/dashboard/TaskSummary";
import { RecentTasks } from "../components/dashboard/RecentTasks";
import { QuickCommand } from "../components/dashboard/QuickCommand";
import { CostOverview } from "../components/dashboard/CostOverview";

export function DashboardPage() {
  const { fetchAgents, fetchTasks } = useAgentStore();

  useEffect(() => {
    fetchAgents();
    fetchTasks();
  }, [fetchAgents, fetchTasks]);

  return (
    <div className="h-full p-6 overflow-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
          📊 대시보드
        </h1>
        <p className="text-xs text-text-muted mt-1">에이전트 현황과 작업 상태를 한눈에 확인하세요</p>
      </div>

      {/* Quick Command */}
      <div className="mb-6">
        <QuickCommand />
      </div>

      {/* Main Grid: 2/3 + 1/3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <AgentStatusList />
          <TaskSummary />
        </div>
        <div className="space-y-5">
          <RecentTasks />
          <CostOverview />
        </div>
      </div>
    </div>
  );
}
