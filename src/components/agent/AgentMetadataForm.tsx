import { Trash2 } from "lucide-react";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import AvatarUploader from "./AvatarUploader";
import { useLabels } from "../../hooks/useLabels";

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
  canDelete, onDelete,
}: Props) {
  const labels = useLabels();
  const nameComposition = useCompositionInput(onNameChange);
  const descComposition = useCompositionInput(onDescriptionChange);

  return (
    <div className="agent-editor-left">
      <AvatarUploader avatar={avatar} onChange={onAvatarChange} />

      <div className="form-group">
        <label>이름</label>
        <input
          type="text"
          value={name}
          placeholder={labels.agentNamePlaceholder}
          {...nameComposition.compositionProps}
        />
      </div>

      <div className="form-group">
        <label>설명</label>
        <input
          type="text"
          value={description}
          placeholder={labels.agentDescPlaceholder}
          {...descComposition.compositionProps}
        />
      </div>

      <div className="agent-editor-divider" />

      <div className="form-group">
        <label>모델 (비워두면 글로벌 설정 사용)</label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          <option value="">글로벌 설정 사용</option>
          {!models.includes(model) && model && (
            <option value={model}>{model}</option>
          )}
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Temperature (비워두면 기본값)</label>
        <input
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={temperature}
          onChange={(e) => onTemperatureChange(e.target.value)}
          placeholder="기본값"
        />
      </div>

      <div className="form-group">
        <label>Thinking 모드</label>
        <div className="agent-thinking-select">
          <button
            className={`thinking-option ${thinkingEnabled === null ? "active" : ""}`}
            onClick={() => onThinkingEnabledChange(null)}
          >
            글로벌
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
            placeholder="글로벌 설정 사용"
          />
        </div>
      )}

      {canDelete && (
        <>
          <div className="agent-editor-divider" />
          <button className="agent-delete-btn" onClick={onDelete}>
            <Trash2 size={16} />
            {labels.deleteAgent}
          </button>
        </>
      )}
    </div>
  );
}
