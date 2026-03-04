import { ChevronRight, Plus, Bot, Shield } from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { useChatStore } from "../../stores/chatStore";

export default function AgentSelector() {
  const agents = useAgentStore((s) => s.agents);
  const startBootstrap = useChatStore((s) => s.startBootstrap);
  const prepareForAgent = useChatStore((s) => s.prepareForAgent);

  const handleSelectAgent = (agentId: string) => {
    prepareForAgent(agentId);
  };

  return (
    <div className="agent-selector">
      <div className="agent-selector-header">
        <h2>에이전트 선택</h2>
        <p>대화할 에이전트를 선택하세요</p>
      </div>

      <div className="agent-selector-list">
        {(agents ?? []).map((agent) => (
          <div
            key={agent.id}
            className="agent-selector-card"
            onClick={() => handleSelectAgent(agent.id)}
          >
            <div className="agent-selector-avatar">
              {agent.avatar ? (
                <img src={agent.avatar} alt={agent.name} />
              ) : (
                <Bot size={28} />
              )}
            </div>
            <div className="agent-selector-info">
              <div className="agent-selector-name">
                {agent.name}
                {agent.is_default && (
                  <span className="agent-badge-manager">
                    <Shield size={10} />
                    MANAGER
                  </span>
                )}
              </div>
              {agent.description && (
                <div className="agent-selector-desc">{agent.description}</div>
              )}
            </div>
            <ChevronRight size={18} className="agent-selector-arrow" />
          </div>
        ))}

        <div className="agent-selector-card new-agent" onClick={() => startBootstrap()}>
          <div className="agent-selector-avatar new-agent-icon">
            <Plus size={24} />
          </div>
          <div className="agent-selector-info">
            <div className="agent-selector-name">새 에이전트</div>
            <div className="agent-selector-desc">대화로 새 에이전트의 페르소나를 만듭니다</div>
          </div>
        </div>
      </div>
    </div>
  );
}
