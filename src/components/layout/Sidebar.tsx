import { Bot, MessageSquare, Plus, Settings, Trash2 } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { DEFAULT_CONVERSATION_TITLE } from "../../constants";

export default function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const createNewConversation = useChatStore((s) => s.createNewConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);

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
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`menu-item conversation-item ${conv.id === currentConversationId ? "active" : ""}`}
              onClick={() => selectConversation(conv.id)}
            >
              <MessageSquare size={18} />
              <span className="conversation-title">{conv.title}</span>
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
          ))}
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
