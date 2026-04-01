import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Bot, Clock, Globe, Network, Plus, Settings, Users } from "lucide-react";
import { useConversationStore } from "../../stores/conversationStore";
import { useAgentStore } from "../../stores/agentStore";
import { useTeamStore } from "../../stores/teamStore";
import { useCronStore } from "../../stores/cronStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { resetChatContext } from "../../stores/resetHelper";
import { useDragRegion } from "../../hooks/useDragRegion";

export default function Sidebar() {
  const conversations = useConversationStore((s) => s.conversations);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const openAgentChat = useConversationStore((s) => s.openAgentChat);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const startBootstrap = useBootstrapStore((s) => s.startBootstrap);
  const isBootstrapping = useBootstrapStore((s) => s.isBootstrapping);
  const teams = useTeamStore((s) => s.teams);
  const cronJobs = useCronStore((s) => s.jobs);
  const { mainView, toggleView, setMainView } = useNavigationStore();
  const { t } = useTranslation("glossary");
  const tt = useTranslation("team").t;
  const tc = useTranslation("cron").t;
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const companyName = useSettingsStore((s) => s.companyName);
  const { onMouseDown: onDrag, onDoubleClick: onDragDblClick } = useDragRegion();

  // Build a map: agentId → most recent conversation's updated_at (DM only)
  const agentLastActivity = useMemo(() => {
    const map = new Map<string, string>();
    // conversations are sorted by updated_at DESC, so first match is the latest
    for (const conv of conversations) {
      if (!conv.team_id && !map.has(conv.agent_id)) {
        map.set(conv.agent_id, conv.updated_at);
      }
    }
    return map;
  }, [conversations]);

  // Sort agents: those with recent conversations first, then by sort_order
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aTime = agentLastActivity.get(a.id);
      const bTime = agentLastActivity.get(b.id);
      if (aTime && bTime) return bTime.localeCompare(aTime);
      if (aTime && !bTime) return -1;
      if (!aTime && bTime) return 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }, [agents, agentLastActivity]);

  const isActive = (agentId: string) => {
    if (isBootstrapping) return false;
    if (currentConversationId) {
      const conv = conversations.find((c) => c.id === currentConversationId);
      return conv?.agent_id === agentId;
    }
    return selectedAgentId === agentId;
  };

  const handleNewAgent = async () => {
    // Reset first, then start bootstrap. If bootstrap fails, we stay in empty state
    // which is better than losing context silently. Bootstrap failure is rare (only if
    // getBootstrapPrompt() fails) and the user can click any agent to recover.
    resetChatContext();
    await startBootstrap();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header" onMouseDown={onDrag} onDoubleClick={onDragDblClick}>
        <div className="logo-icon">
          <Bot size={24} />
        </div>
        <h1>{t("appTitle", { companyName, context: uiTheme })}</h1>
      </div>

      <div className="sidebar-content">
        <div
          className={`menu-item new-chat-btn ${isBootstrapping ? "active" : ""}`}
          onClick={() => { setMainView("chat"); handleNewAgent(); }}
        >
          <Plus size={20} />
          <span>{t("sidebarNewButton", { context: uiTheme })}</span>
        </div>

        <div className="conversation-list" data-tour-id="sidebar-agents">
          {sortedAgents.map((agent) => (
            <div
              key={agent.id}
              className={`menu-item conversation-item ${isActive(agent.id) ? "active" : ""}`}
              onClick={() => { setMainView("chat"); openAgentChat(agent.id); }}
            >
              {agent.avatar ? (
                <img
                  src={agent.avatar}
                  alt={agent.name}
                  className="conversation-agent-avatar"
                />
              ) : (
                <Bot size={22} />
              )}
              <div className="conversation-text">
                <span className="conversation-title">{agent.name}</span>
                {agent.description && (
                  <span className="conversation-agent-name">{agent.description}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          className={`menu-item ${mainView === "agent" ? "active" : ""}`}
          onClick={() => toggleView("agent")}
        >
          <Users size={20} />
          <span>{t("editAgent", { context: uiTheme })}</span>
          {agents.length > 0 && (
            <span className="sidebar-badge">{agents.length}</span>
          )}
        </div>
        <div
          className={`menu-item ${mainView === "network" ? "active" : ""}`}
          onClick={() => toggleView("network")}
        >
          <Network size={20} />
          <span>{t("network:panel.title")}</span>
        </div>
        <div
          className={`menu-item ${mainView === "vault" ? "active" : ""}`}
          onClick={() => toggleView("vault")}
        >
          <BookOpen size={20} />
          <span>{t("vault:title")}</span>
        </div>
        <div
          className={`menu-item ${mainView === "hub" ? "active" : ""}`}
          onClick={() => toggleView("hub")}
        >
          <Globe size={20} />
          <span>{t("hub:title")}</span>
        </div>
        <div
          className={`menu-item ${mainView === "team" ? "active" : ""}`}
          onClick={() => toggleView("team")}
          data-tour-id="sidebar-team"
        >
          <Users size={20} />
          <span>{tt("title")}</span>
          {teams.length > 0 && (
            <span className="sidebar-badge">{teams.length}</span>
          )}
        </div>
        <div
          className={`menu-item ${mainView === "cron" ? "active" : ""}`}
          onClick={() => toggleView("cron")}
        >
          <Clock size={20} />
          <span>{tc("title")}</span>
          {cronJobs.length > 0 && (
            <span className="sidebar-badge">{cronJobs.length}</span>
          )}
        </div>
        <div
          className={`menu-item settings-btn ${mainView === "settings" ? "active" : ""}`}
          onClick={() => toggleView("settings")}
          data-tour-id="sidebar-settings"
        >
          <Settings size={20} />
          <span>{t("settings:title")}</span>
        </div>
      </div>
    </aside>
  );
}
