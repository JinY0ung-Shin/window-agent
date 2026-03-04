import { useState, useEffect } from "react";
import { X, Trash2 } from "lucide-react";
import { useAgentStore, type PersonaTab } from "../../stores/agentStore";
import AvatarUploader from "./AvatarUploader";

const PERSONA_TABS: { key: PersonaTab; label: string }[] = [
  { key: "identity", label: "IDENTITY" },
  { key: "soul", label: "SOUL" },
  { key: "user", label: "USER" },
  { key: "agents", label: "AGENTS" },
];

const TAB_PLACEHOLDERS: Record<PersonaTab, string> = {
  identity: "이름, 역할, 스타일을 정의합니다 (명함)",
  soul: "핵심 성격, 가치관, 경계선을 정의합니다 (영혼)",
  user: "사용자 이름, 호칭, 선호도를 정의합니다 (사용자 프로필)",
  agents: "업무 방식, 응답 형식, 도구 규칙을 정의합니다 (업무 매뉴얼)",
};

export default function AgentEditor() {
  const isEditorOpen = useAgentStore((s) => s.isEditorOpen);
  const editingAgentId = useAgentStore((s) => s.editingAgentId);
  const agents = useAgentStore((s) => s.agents);
  const personaFiles = useAgentStore((s) => s.personaFiles);
  const personaTab = useAgentStore((s) => s.personaTab);
  const closeEditor = useAgentStore((s) => s.closeEditor);
  const setPersonaTab = useAgentStore((s) => s.setPersonaTab);
  const updatePersonaFile = useAgentStore((s) => s.updatePersonaFile);
  const saveAgent = useAgentStore((s) => s.saveAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);

  const editingAgent = editingAgentId
    ? agents.find((a) => a.id === editingAgentId) ?? null
    : null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean | null>(null);
  const [thinkingBudget, setThinkingBudget] = useState("");

  useEffect(() => {
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
      name: name || "새 에이전트",
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
          <h2>{editingAgentId ? "에이전트 편집" : "새 에이전트"}</h2>
          <button className="close-button" onClick={closeEditor}>
            <X size={20} />
          </button>
        </div>

        {/* Body: 2-column layout */}
        <div className="agent-editor-body">
          {/* Left column: avatar + meta */}
          <div className="agent-editor-left">
            <AvatarUploader avatar={avatar} onChange={setAvatar} />

            <div className="form-group">
              <label>이름</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="에이전트 이름"
              />
            </div>

            <div className="form-group">
              <label>설명</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="에이전트 설명 (한 줄)"
              />
            </div>

            <div className="agent-editor-divider" />

            <div className="form-group">
              <label>모델 (비워두면 글로벌 설정 사용)</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="글로벌 설정 사용"
              />
            </div>

            <div className="form-group">
              <label>Temperature (비워두면 기본값)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="기본값"
              />
            </div>

            <div className="form-group">
              <label>Thinking 모드</label>
              <div className="agent-thinking-select">
                <button
                  className={`thinking-option ${thinkingEnabled === null ? "active" : ""}`}
                  onClick={() => setThinkingEnabled(null)}
                >
                  글로벌
                </button>
                <button
                  className={`thinking-option ${thinkingEnabled === true ? "active" : ""}`}
                  onClick={() => setThinkingEnabled(true)}
                >
                  ON
                </button>
                <button
                  className={`thinking-option ${thinkingEnabled === false ? "active" : ""}`}
                  onClick={() => setThinkingEnabled(false)}
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
                  onChange={(e) => setThinkingBudget(e.target.value)}
                  placeholder="글로벌 설정 사용"
                />
              </div>
            )}

            {editingAgentId && !isDefault && (
              <>
                <div className="agent-editor-divider" />
                <button className="agent-delete-btn" onClick={handleDelete}>
                  <Trash2 size={16} />
                  에이전트 삭제
                </button>
              </>
            )}
          </div>

          {/* Right column: persona tabs + editor */}
          <div className="agent-editor-right">
            <div className="persona-tabs">
              {PERSONA_TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`persona-tab ${personaTab === tab.key ? "active" : ""}`}
                  onClick={() => setPersonaTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <textarea
              className="persona-editor"
              value={personaFiles?.[personaTab] ?? ""}
              onChange={(e) => updatePersonaFile(personaTab, e.target.value)}
              placeholder={TAB_PLACEHOLDERS[personaTab]}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={closeEditor}>
            취소
          </button>
          <button className="btn-primary" onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
