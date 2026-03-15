import { useEffect, useState } from "react";
import { ChevronRight, Plus, Bot, Shield } from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useChatFlowStore } from "../../stores/chatFlowStore";
import { readAgentFile } from "../../services/tauriCommands";
import { useLabels } from "../../hooks/useLabels";

export default function AgentSelector() {
  const agents = useAgentStore((s) => s.agents);
  const startBootstrap = useBootstrapStore((s) => s.startBootstrap);
  const prepareForAgent = useChatFlowStore((s) => s.prepareForAgent);
  const labels = useLabels();
  const [dormantIds, setDormantIds] = useState<Set<string>>(new Set());

  // Check folder existence for each agent
  useEffect(() => {
    if (!agents || agents.length === 0) return;
    let cancelled = false;

    async function checkFolders() {
      const dormant = new Set<string>();
      await Promise.all(
        agents.map(async (agent) => {
          try {
            await readAgentFile(agent.folder_name, "IDENTITY.md");
          } catch {
            dormant.add(agent.id);
          }
        }),
      );
      if (!cancelled) setDormantIds(dormant);
    }

    checkFolders();
    return () => { cancelled = true; };
  }, [agents]);

  const handleSelectAgent = (agentId: string) => {
    prepareForAgent(agentId);
  };

  return (
    <div className="agent-selector">
      <div className="agent-selector-header">
        <h2>{labels.selectAgent}</h2>
        <p>{labels.selectAgentDescription}</p>
      </div>

      <div className="agent-selector-list">
        {(agents ?? []).map((agent) => {
          const isDormant = dormantIds.has(agent.id);
          return (
            <div
              key={agent.id}
              className="agent-selector-card"
              style={isDormant ? { opacity: 0.6 } : undefined}
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
                      {labels.badgeDefault}
                    </span>
                  )}
                  {isDormant && (
                    <span className="agent-badge-dormant">{labels.badgeDormant}</span>
                  )}
                </div>
                {agent.description && (
                  <div className="agent-selector-desc">{agent.description}</div>
                )}
              </div>
              <ChevronRight size={18} className="agent-selector-arrow" />
            </div>
          );
        })}

        <div className="agent-selector-card new-agent" onClick={() => startBootstrap()}>
          <div className="agent-selector-avatar new-agent-icon">
            <Plus size={24} />
          </div>
          <div className="agent-selector-info">
            <div className="agent-selector-name">{labels.newAgent}</div>
            <div className="agent-selector-desc">{labels.newAgentDescription}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
