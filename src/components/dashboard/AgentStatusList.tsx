import { useAgentStore } from "../../stores/agentStore";
import { AgentStatusCard } from "./AgentStatusCard";
import { AppIcon } from "../ui/AppIcon";
import { EmptyState } from "../ui/EmptyState";
import { SurfaceCard } from "../ui/SurfaceCard";

export function AgentStatusList() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <SurfaceCard>
      <h2 className="section-title">
        <AppIcon name="bot" size={15} className="text-accent-400" />
        <span>에이전트 현황</span>
        <span className="ml-auto rounded-full bg-surface-700/70 px-2 py-0.5 text-xs font-medium text-text-secondary">
          {agents.length}명
        </span>
      </h2>
      <div className="space-y-3">
        {agents.map((agent) => (
          <AgentStatusCard key={agent.id} agent={agent} />
        ))}
        {agents.length === 0 && (
          <EmptyState
            icon="bot"
            title="등록된 에이전트가 없습니다"
            description="인사관리에서 첫 에이전트를 채용해 보세요."
          />
        )}
      </div>
    </SurfaceCard>
  );
}
