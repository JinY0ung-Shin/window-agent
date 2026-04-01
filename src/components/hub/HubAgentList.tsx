import { useTranslation } from "react-i18next";
import { Bot, Loader2, Wrench, BookOpen } from "lucide-react";
import { useHubStore } from "../../stores/hubStore";
import EmptyState from "../common/EmptyState";
import type { SharedAgent } from "../../services/commands/hubCommands";

function AgentCard({ agent }: { agent: SharedAgent }) {
  const { t } = useTranslation("hub");
  const selectAgent = useHubStore((s) => s.selectAgent);

  return (
    <div
      className="hub-card"
      role="button"
      tabIndex={0}
      onClick={() => selectAgent(agent.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") selectAgent(agent.id); }}
    >
      <div className="hub-card-header">
        <Bot size={18} className="hub-card-icon" />
        <div className="hub-card-title">{agent.name}</div>
      </div>
      {agent.description && (
        <div className="hub-card-desc">{agent.description}</div>
      )}
      <div className="hub-card-footer">
        <span className="hub-card-author">{agent.display_name}</span>
        <div className="hub-card-badges">
          {agent.skills_count > 0 && (
            <span className="hub-badge" title={t("agent.skills")}>
              <Wrench size={12} />
              {agent.skills_count}
            </span>
          )}
          {agent.notes_count > 0 && (
            <span className="hub-badge" title={t("agent.notes")}>
              <BookOpen size={12} />
              {agent.notes_count}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HubAgentList() {
  const { t } = useTranslation("hub");
  const agents = useHubStore((s) => s.agents);
  const agentsLoading = useHubStore((s) => s.agentsLoading);

  if (agentsLoading && agents.length === 0) {
    return (
      <div className="hub-loading">
        <Loader2 size={24} className="hub-spinner" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        icon={<Bot size={40} strokeWidth={1.5} />}
        message={t("empty.agents")}
        hint={t("empty.agentsHint")}
        className="hub-empty"
      />
    );
  }

  return (
    <div className="hub-card-grid">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
