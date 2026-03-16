import { useMemo, useState } from "react";
import { Bot, Check, Eraser, Plus, Settings, Users, X } from "lucide-react";
import { useConversationStore } from "../../stores/conversationStore";
import { useAgentStore } from "../../stores/agentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { resetChatContext } from "../../stores/resetHelper";
import { useLabels, useCompanyName } from "../../hooks/useLabels";
import { useDragRegion } from "../../hooks/useDragRegion";

export default function Sidebar() {
  const conversations = useConversationStore((s) => s.conversations);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const openAgentChat = useConversationStore((s) => s.openAgentChat);
  const clearAgentChat = useConversationStore((s) => s.clearAgentChat);
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const openEditor = useAgentStore((s) => s.openEditor);
  const startBootstrap = useBootstrapStore((s) => s.startBootstrap);
  const isBootstrapping = useBootstrapStore((s) => s.isBootstrapping);
  const labels = useLabels();
  const companyName = useCompanyName();
  const onDrag = useDragRegion();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Build a map: agentId → most recent conversation's updated_at
  const agentLastActivity = useMemo(() => {
    const map = new Map<string, string>();
    // conversations are sorted by updated_at DESC, so first match is the latest
    for (const conv of conversations) {
      if (!map.has(conv.agent_id)) {
        map.set(conv.agent_id, conv.updated_at);
      }
    }
    return map;
  }, [conversations]);

  // Build a map: agentId → has conversation
  const agentHasConv = useMemo(() => {
    const set = new Set<string>();
    for (const conv of conversations) {
      set.add(conv.agent_id);
    }
    return set;
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

  const handleOpenAgentEditor = () => {
    const activeAgentId = (() => {
      if (currentConversationId) {
        const conv = conversations.find((c) => c.id === currentConversationId);
        return conv?.agent_id ?? null;
      }
      return selectedAgentId;
    })();
    const agentId = activeAgentId ?? agents.find((a) => a.is_default)?.id ?? null;
    openEditor(agentId);
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
      <div className="sidebar-header" onMouseDown={onDrag}>
        <div className="logo-icon">
          <Bot size={24} />
        </div>
        <h1>{labels.appTitle(companyName)}</h1>
      </div>

      <div className="sidebar-content">
        <div
          className={`menu-item new-chat-btn ${isBootstrapping ? "active" : ""}`}
          onClick={handleNewAgent}
        >
          <Plus size={20} />
          <span>{labels.sidebarNewButton}</span>
        </div>

        <div className="conversation-list">
          {sortedAgents.map((agent) => (
            <div
              key={agent.id}
              className={`menu-item conversation-item ${isActive(agent.id) ? "active" : ""}`}
              onClick={() => openAgentChat(agent.id)}
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
              {agentHasConv.has(agent.id) && (
                confirmDeleteId === agent.id ? (
                  <div className="delete-confirm-inline" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="delete-confirm-yes"
                      onClick={() => {
                        clearAgentChat(agent.id);
                        setConfirmDeleteId(null);
                      }}
                      title={labels.clearChat}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      className="delete-confirm-no"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(agent.id);
                    }}
                    title={labels.clearChat}
                  >
                    <Eraser size={14} />
                  </button>
                )
              )}
            </div>
          ))}
        </div>

        <div
          className="menu-item"
          onClick={handleOpenAgentEditor}
        >
          <Users size={20} />
          <span>{labels.editAgent}</span>
        </div>
        <div
          className="menu-item settings-btn"
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings size={20} />
          <span>설정</span>
        </div>
      </div>
    </aside>
  );
}
