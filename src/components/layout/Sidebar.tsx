import { useMemo } from "react";
import { Bot, MessageSquare, Plus, Settings, Trash2, Users } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { DEFAULT_CONVERSATION_TITLE } from "../../constants";

export default function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const createNewConversation = useChatStore((s) => s.createNewConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);
  const agents = useAgentStore((s) => s.agents);
  const openEditor = useAgentStore((s) => s.openEditor);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  const handleOpenAgentEditor = () => {
    // Open current conversation's agent, or selected agent, or default agent
    const conv = conversations.find((c) => c.id === currentConversationId);
    const agentId = conv?.agent_id ?? selectedAgentId ?? agents.find((a) => a.is_default)?.id ?? null;
    openEditor(agentId);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-icon">
          <Bot size={24} />
        </div>
        <h1>Agent Workspace</h1>
      </div>

      <div className="sidebar-content">
        <div
          className={`menu-item new-chat-btn ${currentConversationId === null ? "active" : ""}`}
          onClick={createNewConversation}
        >
          <Plus size={20} />
          <span>{DEFAULT_CONVERSATION_TITLE}</span>
        </div>

        <div className="conversation-list">
          {conversations.map((conv) => {
            const agent = agentMap.get(conv.agent_id);
            return (
              <div
                key={conv.id}
                className={`menu-item conversation-item ${conv.id === currentConversationId ? "active" : ""}`}
                onClick={() => selectConversation(conv.id)}
              >
                {agent?.avatar ? (
                  <img
                    src={agent.avatar}
                    alt={agent.name}
                    className="conversation-agent-avatar"
                  />
                ) : (
                  <MessageSquare size={18} />
                )}
                <div className="conversation-text">
                  <span className="conversation-title">{conv.title}</span>
                  {agent && (
                    <span className="conversation-agent-name">{agent.name}</span>
                  )}
                </div>
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>

        <div
          className="menu-item"
          onClick={handleOpenAgentEditor}
        >
          <Users size={20} />
          <span>에이전트 관리</span>
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
