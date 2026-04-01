import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, Plus, Trash2, Bot, Settings, Crown, Upload, AlertTriangle } from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useHubStore } from "../../stores/hubStore";
import { resetChatContext } from "../../stores/resetHelper";
import AgentEditor from "./AgentEditor";
import DraggableHeader from "../layout/DraggableHeader";
import EmptyState from "../common/EmptyState";
import Modal from "../common/Modal";

interface DeleteTarget {
  id: string;
  name: string;
}

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

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteMemory, setDeleteMemory] = useState(true);
  const hubLoggedIn = useHubStore((s) => s.loggedIn);
  const openShareDialog = useHubStore((s) => s.openShareDialog);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleNewAgent = async () => {
    resetChatContext();
    setMainView("chat");
    await startBootstrap();
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteAgent(deleteTarget.id, deleteMemory);
    setDeleteTarget(null);
    setDeleteMemory(true);
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
                    {hubLoggedIn && (
                      <button
                        className="agent-card-share"
                        onClick={() => openShareDialog(agent.id, agent.folder_name, agent.name, agent.description)}
                        title={t("shareAgent", { context: uiTheme })}
                      >
                        <Upload size={14} />
                      </button>
                    )}
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
                        onClick={() => setDeleteTarget({ id: agent.id, name: agent.name })}
                        title={t("deleteAgent", { context: uiTheme })}
                      >
                        <Trash2 size={14} />
                      </button>
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

      {deleteTarget && (
        <Modal
          title={t("deleteConfirmTitle", { context: uiTheme })}
          onClose={() => { setDeleteTarget(null); setDeleteMemory(true); }}
          overlayClose="currentTarget"
          contentClassName="agent-delete-dialog"
          footer={
            <div className="agent-delete-footer">
              <button className="btn-secondary" onClick={() => { setDeleteTarget(null); setDeleteMemory(true); }}>
                {t("common:cancel")}
              </button>
              <button className="btn-danger" onClick={handleDelete}>
                <Trash2 size={14} />
                {t("deleteAgent", { context: uiTheme })}
              </button>
            </div>
          }
        >
          <div className="agent-delete-content">
            <div className="agent-delete-warning">
              <AlertTriangle size={20} />
              <span>{t("deleteConfirmMessage", { context: uiTheme, name: deleteTarget.name })}</span>
            </div>
            <label className="agent-delete-checkbox">
              <input
                type="checkbox"
                checked={deleteMemory}
                onChange={(e) => setDeleteMemory(e.target.checked)}
              />
              {t("deleteWithMemory", { context: uiTheme })}
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
