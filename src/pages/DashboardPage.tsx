import { useEffect } from "react";
import { useAgentStore } from "../stores/agentStore";
import { AgentStatusList } from "../components/dashboard/AgentStatusList";
import { TaskSummary } from "../components/dashboard/TaskSummary";
import { RecentTasks } from "../components/dashboard/RecentTasks";
import { QuickCommand } from "../components/dashboard/QuickCommand";

export function DashboardPage() {
  const { fetchAgents, fetchTasks } = useAgentStore();

  useEffect(() => {
    fetchAgents();
    fetchTasks();
  }, [fetchAgents, fetchTasks]);

  return (
    <div className="h-full p-5 overflow-auto">
      <div className="mb-5">
        <QuickCommand />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <AgentStatusList />
          <TaskSummary />
        </div>
        <div>
          <RecentTasks />
        </div>
      </div>
    </div>
  );
}
