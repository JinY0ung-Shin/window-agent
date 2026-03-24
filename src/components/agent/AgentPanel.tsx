import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, Plus, Trash2, Bot, Settings, Crown } from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { resetChatContext } from "../../stores/resetHelper";
import AgentEditor from "./AgentEditor";
import DraggableHeader from "../layout/DraggableHeader";
import EmptyState from "../common/EmptyState";

export default function AgentPanel() {
  const { t } = useTranslation("glossary");
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const isEditorOpen = useAgentStore((s) => s.isEditorOpen);
  const openEditor = useAgentStore((s) => s.openEditor);
  const startBootstrap = useBootstrapStore((s) => s.startBootstrap);
  const setMainView = useNavigationStore((s) => s.setMainView);
  const uiTheme = useSettingsStore((s) => s.uiTheme);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleNewAgent = async () => {
    resetChatContext();
    setMainView("chat");
    await startBootstrap();
  };

  const handleDelete = (id: string) => {
    deleteAgent(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="agent-panel">
      <DraggableHeader className="agent-panel-header">
        <div className="agent-panel-title">
          <Users size={22} />
          <h2>{t("editorTitle", { context: uiTheme })}</h2>
        </div>
        <button className="btn-primary agent-create-btn" onClick={handleNewAgent} data-tour-id="agent-add-btn">
          <Plus size={16} />
          {t("editorNewTitle", { context: uiTheme })}
        </button>
      </DraggableHeader>

      <div className="agent-panel-body">
        {agents.length === 0 ? (
          <EmptyState
            icon={<Bot size={48} strokeWidth={1} />}
            message={t("noAgents", { context: uiTheme })}
            className="agent-empty"
          />
        ) : (
          <div className="agent-grid">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="agent-card"
                onClick={() => openEditor(agent.id)}
              >
                <div className="agent-card-header">
                  <div className="agent-card-identity">
                    {agent.avatar ? (
                      <img src={agent.avatar} alt={agent.name} className="agent-card-avatar" />
                    ) : (
                      <div className="agent-card-avatar-fallback">
                        <Bot size={20} />
                      </div>
                    )}
                    <div className="agent-card-name">{agent.name}</div>
                    {agent.is_default && (
                      <span className="agent-card-badge">
                        <Crown size={10} />
                        {t("badgeDefault", { context: uiTheme })}
                      </span>
                    )}
                  </div>
                  <div className="agent-card-actions" onClick={(e) => e.stopPropagation()}>
                    {confirmDeleteId === agent.id ? (
                      <div className="agent-card-delete-confirm">
                        <button
                          className="btn-danger-sm"
                          onClick={() => handleDelete(agent.id)}
                        >
                          {t("common:delete")}
                        </button>
                        <button
                          className="btn-secondary-sm"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          {t("common:cancel")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          className="agent-card-edit"
                          onClick={() => openEditor(agent.id)}
                          title={t("editAgent", { context: uiTheme })}
                        >
                          <Settings size={14} />
                        </button>
                        {!agent.is_default && (
                          <button
                            className="agent-card-delete"
                            onClick={() => setConfirmDeleteId(agent.id)}
                            title={t("deleteAgent", { context: uiTheme })}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {agent.description && (
                  <div className="agent-card-desc">{agent.description}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isEditorOpen && <AgentEditor />}
    </div>
  );
}
