import { useAgentStore } from "../../stores/agentStore";
import { AgentStatusCard } from "./AgentStatusCard";

export function AgentStatusList() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <div className="card">
      <h2 className="section-title">
        <span>🤖</span>
        <span>에이전트 현황</span>
        <span className="ml-auto text-xs font-normal text-text-muted bg-surface-700/60 px-2 py-0.5 rounded-full">
          {agents.length}명
        </span>
      </h2>
      <div className="space-y-3">
        {agents.map((agent) => (
          <AgentStatusCard key={agent.id} agent={agent} />
        ))}
        {agents.length === 0 && (
          <div className="text-center py-10">
            <div className="text-3xl mb-2">🤖</div>
            <p className="text-xs text-text-muted">등록된 에이전트가 없습니다</p>
          </div>
        )}
      </div>
    </div>
  );
}
