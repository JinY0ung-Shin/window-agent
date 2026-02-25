import { useAgentStore } from "../../stores/agentStore";
import { AgentStatusCard } from "./AgentStatusCard";

export function AgentStatusList() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <div>
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        에이전트 현황
      </h2>
      <div className="space-y-3">
        {agents.map((agent) => (
          <AgentStatusCard key={agent.id} agent={agent} />
        ))}
        {agents.length === 0 && (
          <div className="text-xs text-text-muted py-8 text-center">
            등록된 에이전트가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
