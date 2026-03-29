import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import { useSettingsStore } from "../../stores/settingsStore";
import AvatarUploader from "./AvatarUploader";

interface Props {
  avatar: string | null;
  onAvatarChange: (avatar: string | null) => void;
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  models: string[];
  temperature: string;
  onTemperatureChange: (temperature: string) => void;
  thinkingEnabled: boolean | null;
  onThinkingEnabledChange: (enabled: boolean | null) => void;
  thinkingBudget: string;
  onThinkingBudgetChange: (budget: string) => void;
  networkVisible: boolean;
  onNetworkVisibleChange: (visible: boolean) => void;
  canDelete: boolean;
  onDelete: () => void;
}

export default function AgentMetadataForm({
  avatar, onAvatarChange,
  name, onNameChange,
  description, onDescriptionChange,
  model, onModelChange, models,
  temperature, onTemperatureChange,
  thinkingEnabled, onThinkingEnabledChange,
  thinkingBudget, onThinkingBudgetChange,
  networkVisible, onNetworkVisibleChange,
  canDelete, onDelete,
}: Props) {
  const { t } = useTranslation("glossary");
  const ta = useTranslation("agent").t;
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const nameComposition = useCompositionInput(onNameChange);
  const descComposition = useCompositionInput(onDescriptionChange);

  return (
    <div className="agent-editor-left">
      <AvatarUploader avatar={avatar} onChange={onAvatarChange} />

      <div className="form-group">
        <label>{ta("metadata.nameLabel")}</label>
        <input
          type="text"
          value={name}
          placeholder={t("agentNamePlaceholder", { context: uiTheme })}
          {...nameComposition.compositionProps}
        />
      </div>

      <div className="form-group">
        <label>{ta("metadata.descriptionLabel")}</label>
        <input
          type="text"
          value={description}
          placeholder={t("agentDescPlaceholder", { context: uiTheme })}
          {...descComposition.compositionProps}
        />
      </div>

      <div className="agent-editor-divider" />

      <div className="form-group">
        <label>{ta("metadata.modelLabel")}</label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          <option value="">{ta("metadata.globalSettingsOption")}</option>
          {!models.includes(model) && model && (
            <option value={model}>{model}</option>
          )}
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>{ta("metadata.temperatureLabel")}</label>
        <input
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={temperature}
          onChange={(e) => onTemperatureChange(e.target.value)}
          placeholder={ta("metadata.temperaturePlaceholder")}
        />
      </div>

      <div className="form-group">
        <label>{ta("metadata.thinkingLabel")}</label>
        <div className="agent-thinking-select">
          <button
            className={`thinking-option ${thinkingEnabled === null ? "active" : ""}`}
            onClick={() => onThinkingEnabledChange(null)}
          >
            {ta("metadata.thinkingGlobal")}
          </button>
          <button
            className={`thinking-option ${thinkingEnabled === true ? "active" : ""}`}
            onClick={() => onThinkingEnabledChange(true)}
          >
            ON
          </button>
          <button
            className={`thinking-option ${thinkingEnabled === false ? "active" : ""}`}
            onClick={() => onThinkingEnabledChange(false)}
          >
            OFF
          </button>
        </div>
      </div>

      {thinkingEnabled === true && (
        <div className="form-group">
          <label>Thinking Budget</label>
          <input
            type="number"
            min="1024"
            max="32768"
            step="1024"
            value={thinkingBudget}
            onChange={(e) => onThinkingBudgetChange(e.target.value)}
            placeholder={ta("metadata.globalSettingsOption")}
          />
        </div>
      )}

      <div className="agent-editor-divider" />

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={networkVisible}
            onChange={(e) => onNetworkVisibleChange(e.target.checked)}
          />
          {ta("metadata.networkVisible")}
        </label>
        <span className="form-text">{ta("metadata.networkVisibleHint")}</span>
      </div>

      {canDelete && (
        <>
          <div className="agent-editor-divider" />
          <button className="agent-delete-btn" onClick={onDelete}>
            <Trash2 size={16} />
            {t("deleteAgent", { context: uiTheme })}
          </button>
        </>
      )}
    </div>
  );
}
