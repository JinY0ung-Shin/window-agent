import { useState, useEffect, useCallback } from "react";
import { X, Trash2, Plus, AlertTriangle, Pencil, Check, Bot } from "lucide-react";
import { useAgentStore, type PersonaTab } from "../../stores/agentStore";
import { listModels, listSkills, createSkill, readSkill, updateSkill, deleteSkill } from "../../services/tauriCommands";
import type { SkillMetadata } from "../../services/types";
import AvatarUploader from "./AvatarUploader";
import ToolManagementPanel from "./ToolManagementPanel";

const PERSONA_TABS: { key: PersonaTab; label: string }[] = [
  { key: "identity", label: "IDENTITY" },
  { key: "soul", label: "SOUL" },
  { key: "user", label: "USER" },
  { key: "agents", label: "AGENTS" },
];

const TAB_PLACEHOLDERS: Record<Exclude<PersonaTab, "tools">, string> = {
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
  const openEditor = useAgentStore((s) => s.openEditor);
  const editorError = useAgentStore((s) => s.editorError);

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
  const [models, setModels] = useState<string[]>([]);

  // Panel state: persona tabs, tools panel, or skills panel
  const [activePanel, setActivePanel] = useState<"persona" | "tools" | "skills">("persona");
  const [agentSkills, setAgentSkills] = useState<SkillMetadata[]>([]);
  const [globalSkills, setGlobalSkills] = useState<SkillMetadata[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [editingSkillName, setEditingSkillName] = useState<string | null>(null);
  const [editingSkillContent, setEditingSkillContent] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [showNewSkill, setShowNewSkill] = useState(false);
  const [skillError, setSkillError] = useState("");

  const loadAgentSkills = useCallback(async () => {
    if (!editingAgent) return;
    setSkillsLoading(true);
    try {
      const skills = await listSkills(editingAgent.folder_name);
      setAgentSkills(skills.filter((s) => s.source === "agent"));
      setGlobalSkills(skills.filter((s) => s.source === "global"));
    } catch {
      setAgentSkills([]);
      setGlobalSkills([]);
    } finally {
      setSkillsLoading(false);
    }
  }, [editingAgent]);

  useEffect(() => {
    if (isEditorOpen) {
      listModels().then(setModels).catch(() => setModels([]));
    }
  }, [isEditorOpen]);

  useEffect(() => {
    if (isEditorOpen && activePanel === "skills" && editingAgent) {
      loadAgentSkills();
    }
  }, [isEditorOpen, activePanel, editingAgent, loadAgentSkills]);

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

  const handleCreateSkill = async () => {
    if (!editingAgent || !newSkillName.trim()) return;
    setSkillError("");
    try {
      await createSkill(editingAgent.folder_name, newSkillName.trim());
      setNewSkillName("");
      setShowNewSkill(false);
      await loadAgentSkills();
    } catch (e) {
      setSkillError(`생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleEditSkill = async (skillName: string) => {
    if (!editingAgent) return;
    setSkillError("");
    try {
      const content = await readSkill(editingAgent.folder_name, skillName);
      setEditingSkillName(skillName);
      setEditingSkillContent(content.raw_content);
    } catch (e) {
      setSkillError(`읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSaveSkill = async () => {
    if (!editingAgent || !editingSkillName) return;
    setSkillError("");
    try {
      await updateSkill(editingAgent.folder_name, editingSkillName, editingSkillContent);
      setEditingSkillName(null);
      setEditingSkillContent("");
      await loadAgentSkills();
    } catch (e) {
      setSkillError(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteSkill = async (skillName: string) => {
    if (!editingAgent) return;
    if (!confirm(`"${skillName}" 특기를 삭제하시겠습니까?`)) return;
    setSkillError("");
    try {
      await deleteSkill(editingAgent.folder_name, skillName);
      if (editingSkillName === skillName) {
        setEditingSkillName(null);
        setEditingSkillContent("");
      }
      await loadAgentSkills();
    } catch (e) {
      setSkillError(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
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
            <span className="agent-list-name">새 에이전트</span>
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
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
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
                  className={`persona-tab ${activePanel === "persona" && personaTab === tab.key ? "active" : ""}`}
                  onClick={() => { setPersonaTab(tab.key); setActivePanel("persona"); }}
                >
                  {tab.label}
                </button>
              ))}
              <button
                className={`persona-tab ${activePanel === "tools" ? "active" : ""}`}
                onClick={() => setActivePanel("tools")}
              >
                TOOLS
              </button>
              <button
                className={`persona-tab ${activePanel === "skills" ? "active" : ""}`}
                disabled={!editingAgentId}
                title={!editingAgentId ? "먼저 저장하세요" : undefined}
                onClick={() => editingAgentId && setActivePanel("skills")}
              >
                SKILLS
              </button>
            </div>

            {activePanel === "tools" ? (
              <ToolManagementPanel
                key={editingAgentId}
                rawContent={personaFiles?.tools ?? ""}
                onChange={(c) => updatePersonaFile("tools", c)}
              />
            ) : activePanel === "skills" ? (
              <div className="skills-panel">
                {skillsLoading ? (
                  <div className="skills-loading">로딩...</div>
                ) : (
                  <>
                    {editingSkillName && !isDefault ? (
                      <div className="skill-edit-panel">
                        <div className="skill-edit-header">
                          <span className="skill-edit-title">{editingSkillName}</span>
                          <div className="skill-edit-actions">
                            <button className="btn-secondary" onClick={() => { setEditingSkillName(null); setEditingSkillContent(""); }}>
                              <X size={14} /> 취소
                            </button>
                            <button className="btn-primary" onClick={handleSaveSkill}>
                              <Check size={14} /> 저장
                            </button>
                          </div>
                        </div>
                        <textarea
                          className="persona-editor"
                          value={editingSkillContent}
                          onChange={(e) => setEditingSkillContent(e.target.value)}
                          placeholder="SKILL.md 내용을 입력하세요"
                          spellCheck={false}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="skills-section">
                          <div className="skills-section-header">
                            <span>에이전트 특기</span>
                            {!isDefault && (
                              <button
                                className="btn-secondary skill-add-btn"
                                onClick={() => setShowNewSkill(true)}
                              >
                                <Plus size={14} /> 새 특기 추가
                              </button>
                            )}
                          </div>

                          {!isDefault && showNewSkill && (
                            <div className="skill-new-row">
                              <input
                                type="text"
                                value={newSkillName}
                                onChange={(e) => setNewSkillName(e.target.value)}
                                placeholder="특기 이름 (예: code-review)"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleCreateSkill();
                                  if (e.key === "Escape") setShowNewSkill(false);
                                }}
                                autoFocus
                              />
                              <button className="btn-primary" onClick={handleCreateSkill}>생성</button>
                              <button className="btn-secondary" onClick={() => setShowNewSkill(false)}>취소</button>
                            </div>
                          )}

                          {agentSkills.length === 0 && !showNewSkill && (
                            <div className="skills-empty">아직 특기가 없습니다</div>
                          )}

                          {agentSkills.map((skill) => (
                            <div key={skill.name} className="skill-row">
                              <div className="skill-row-info">
                                <span className="skill-row-name">{skill.name}</span>
                                <span className="skill-row-desc">{skill.description || "(설명 없음)"}</span>
                              </div>
                              {skill.diagnostics.length > 0 && (
                                <span className="skill-row-warn" title={skill.diagnostics.join("\n")}>
                                  <AlertTriangle size={14} />
                                </span>
                              )}
                              {!isDefault && (
                                <div className="skill-row-actions">
                                  <button onClick={() => handleEditSkill(skill.name)} title="편집">
                                    <Pencil size={14} />
                                  </button>
                                  <button onClick={() => handleDeleteSkill(skill.name)} title="삭제">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {globalSkills.length > 0 && (
                          <div className="skills-section">
                            <div className="skills-section-header">
                              <span>공유 특기 (읽기 전용)</span>
                            </div>
                            {globalSkills.map((skill) => (
                              <div key={skill.name} className="skill-row skill-row-global">
                                <div className="skill-row-info">
                                  <span className="skill-row-name">{skill.name}</span>
                                  <span className="skill-row-desc">{skill.description || "(설명 없음)"}</span>
                                </div>
                                {skill.diagnostics.length > 0 && (
                                  <span className="skill-row-warn" title={skill.diagnostics.join("\n")}>
                                    <AlertTriangle size={14} />
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {skillError && <div className="skill-error">{skillError}</div>}
                  </>
                )}
              </div>
            ) : (
              <textarea
                className="persona-editor"
                value={personaFiles?.[personaTab] ?? ""}
                onChange={(e) => updatePersonaFile(personaTab, e.target.value)}
                placeholder={TAB_PLACEHOLDERS[personaTab as Exclude<PersonaTab, "tools">]}
                spellCheck={false}
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
