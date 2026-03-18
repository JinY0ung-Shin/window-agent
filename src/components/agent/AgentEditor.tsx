import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Bot } from "lucide-react";
import { listModels } from "../../services/tauriCommands";
import { useAgentEditor } from "../../hooks/useAgentEditor";
import { useSettingsStore } from "../../stores/settingsStore";
import AgentMetadataForm from "./AgentMetadataForm";
import AgentPersonaEditor, { PERSONA_TABS } from "./AgentPersonaEditor";
import AgentSkillsPanel from "./AgentSkillsPanel";
import NativeToolPanel from "./NativeToolPanel";
import CredentialPanel from "./CredentialPanel";
import type { ToolConfig } from "../../services/types";
import { useAgentStore } from "../../stores/agentStore";

export default function AgentEditor() {
  const {
    isEditorOpen, editingAgentId, editingAgent, agents,
    personaFiles, personaTab, editorError,
    closeEditor, setPersonaTab, updatePersonaFile,
    saveAgent, deleteAgent, openEditor,
  } = useAgentEditor();

  const { t } = useTranslation("glossary");
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const ta = useTranslation("agent").t;
  const toolConfig = useAgentStore((s) => s.toolConfig);
  const setToolConfig = (config: ToolConfig) => useAgentStore.setState({ toolConfig: config });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean | null>(null);
  const [thinkingBudget, setThinkingBudget] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<"persona" | "tools" | "credentials" | "skills">("persona");

  useEffect(() => {
    if (isEditorOpen) {
      listModels().then(setModels).catch(() => setModels([]));
    }
  }, [isEditorOpen]);

  useEffect(() => {
    setActivePanel("persona");
    if (editingAgent) {
      setName(editingAgent.name);
      setDescription(editingAgent.description);
      setAvatar(editingAgent.avatar);
      setModel(editingAgent.model ?? "");
      setTemperature(editingAgent.temperature != null ? String(editingAgent.temperature) : "");
      setThinkingEnabled(editingAgent.thinking_enabled);
      setThinkingBudget(editingAgent.thinking_budget != null ? String(editingAgent.thinking_budget) : "");
    } else {
      setName("");
      setDescription("");
      setAvatar(null);
      setModel("");
      setTemperature("");
      setThinkingEnabled(null);
      setThinkingBudget("");
    }
  }, [editingAgent]);

  if (!isEditorOpen) return null;

  const isDefault = editingAgent?.is_default === true;

  const handleSave = () => {
    saveAgent({
      name: name || t("newAgent", { context: uiTheme }),
      description,
      avatar,
      model: model || null,
      temperature: temperature ? parseFloat(temperature) : null,
      thinking_enabled: thinkingEnabled,
      thinking_budget: thinkingBudget ? parseInt(thinkingBudget, 10) : null,
    });
  };

  const handleDelete = () => {
    if (editingAgentId && !isDefault) {
      deleteAgent(editingAgentId);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeEditor();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="agent-editor-modal">
        {/* Header */}
        <div className="modal-header">
          <h2>{editingAgentId ? t("editorTitle", { context: uiTheme }) : t("editorNewTitle", { context: uiTheme })}</h2>
          <button className="close-button" onClick={closeEditor}>
            <X size={20} />
          </button>
        </div>

        {/* Agent list strip */}
        <div className="agent-list-strip">
          {agents.map((agent) => (
            <button
              key={agent.id}
              className={`agent-list-item ${agent.id === editingAgentId ? "active" : ""}`}
              onClick={() => openEditor(agent.id)}
            >
              {agent.avatar ? (
                <img src={agent.avatar} alt="" className="agent-list-avatar" />
              ) : (
                <span className="agent-list-icon"><Bot size={14} /></span>
              )}
              <span className="agent-list-name">{agent.name}</span>
            </button>
          ))}
          <button
            className={`agent-list-item ${!editingAgentId ? "active" : ""}`}
            onClick={() => openEditor(null)}
          >
            <span className="agent-list-icon"><Plus size={14} /></span>
            <span className="agent-list-name">{t("editorNewTitle", { context: uiTheme })}</span>
          </button>
        </div>

        {/* Body: 2-column layout */}
        <div className="agent-editor-body">
          {/* Left column: avatar + meta */}
          <AgentMetadataForm
            avatar={avatar}
            onAvatarChange={setAvatar}
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            model={model}
            onModelChange={setModel}
            models={models}
            temperature={temperature}
            onTemperatureChange={setTemperature}
            thinkingEnabled={thinkingEnabled}
            onThinkingEnabledChange={setThinkingEnabled}
            thinkingBudget={thinkingBudget}
            onThinkingBudgetChange={setThinkingBudget}
            canDelete={!!editingAgentId && !isDefault}
            onDelete={handleDelete}
          />

          {/* Right column: persona tabs + editor */}
          <div className="agent-editor-right">
            <div className="persona-tabs">
              {PERSONA_TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`persona-tab ${activePanel === "persona" && personaTab === tab.key ? "active" : ""}`}
                  onClick={() => { setPersonaTab(tab.key); setActivePanel("persona"); }}
                >
                  {({
                    identity: t("personaIdentity", { context: uiTheme }),
                    soul: t("personaSoul", { context: uiTheme }),
                    user: t("personaUser", { context: uiTheme }),
                    agents: t("personaAgents", { context: uiTheme }),
                  } as Record<string, string>)[tab.key] ?? tab.label}
                </button>
              ))}
              <button
                className={`persona-tab ${activePanel === "tools" ? "active" : ""}`}
                onClick={() => setActivePanel("tools")}
              >
                {t("personaTools", { context: uiTheme })}
              </button>
              <button
                className={`persona-tab ${activePanel === "credentials" ? "active" : ""}`}
                onClick={() => setActivePanel("credentials")}
              >
                {ta("credentials.title")}
              </button>
              <button
                className={`persona-tab ${activePanel === "skills" ? "active" : ""}`}
                disabled={!editingAgentId}
                title={!editingAgentId ? ta("skills.saveFirst") : undefined}
                onClick={() => editingAgentId && setActivePanel("skills")}
              >
                {ta("skills.tabLabel")}
              </button>
            </div>

            {activePanel === "tools" ? (
              <NativeToolPanel
                key={editingAgentId}
                folderName={editingAgent?.folder_name ?? ""}
                toolConfig={toolConfig}
                onChange={setToolConfig}
              />
            ) : activePanel === "credentials" ? (
              <CredentialPanel
                key={editingAgentId}
                toolConfig={toolConfig}
                onChange={setToolConfig}
              />
            ) : activePanel === "skills" ? (
              <AgentSkillsPanel
                agent={editingAgent}
                isDefault={isDefault}
                isOpen={activePanel === "skills"}
              />
            ) : (
              <AgentPersonaEditor
                personaFiles={personaFiles}
                personaTab={personaTab}
                onFileChange={updatePersonaFile}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        {editorError && (
          <div className="modal-error">{editorError}</div>
        )}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={closeEditor}>
            {t("common:cancel")}
          </button>
          <button className="btn-primary" onClick={handleSave}>
            {t("common:save")}
          </button>
        </div>
      </div>
    </div>
  );
}
