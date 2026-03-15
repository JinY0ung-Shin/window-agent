import { useState, useEffect, useCallback } from "react";
import { X, Trash2, Plus, AlertTriangle, Pencil, Check } from "lucide-react";
import { listSkills, createSkill, readSkill, updateSkill, deleteSkill } from "../../services/tauriCommands";
import type { SkillMetadata } from "../../services/types";
import type { Agent } from "../../services/types";

interface Props {
  agent: Agent | null;
  isDefault: boolean;
  isOpen: boolean;
}

export default function AgentSkillsPanel({ agent, isDefault, isOpen }: Props) {
  const [agentSkills, setAgentSkills] = useState<SkillMetadata[]>([]);
  const [globalSkills, setGlobalSkills] = useState<SkillMetadata[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [editingSkillName, setEditingSkillName] = useState<string | null>(null);
  const [editingSkillContent, setEditingSkillContent] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [showNewSkill, setShowNewSkill] = useState(false);
  const [skillError, setSkillError] = useState("");

  const loadAgentSkills = useCallback(async () => {
    if (!agent) return;
    setSkillsLoading(true);
    try {
      const skills = await listSkills(agent.folder_name);
      setAgentSkills(skills.filter((s) => s.source === "agent"));
      setGlobalSkills(skills.filter((s) => s.source === "global"));
    } catch {
      setAgentSkills([]);
      setGlobalSkills([]);
    } finally {
      setSkillsLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    if (isOpen && agent) {
      loadAgentSkills();
    }
  }, [isOpen, agent, loadAgentSkills]);

  const handleCreateSkill = async () => {
    if (!agent || !newSkillName.trim()) return;
    setSkillError("");
    try {
      await createSkill(agent.folder_name, newSkillName.trim());
      setNewSkillName("");
      setShowNewSkill(false);
      await loadAgentSkills();
    } catch (e) {
      setSkillError(`생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleEditSkill = async (skillName: string) => {
    if (!agent) return;
    setSkillError("");
    try {
      const content = await readSkill(agent.folder_name, skillName);
      setEditingSkillName(skillName);
      setEditingSkillContent(content.raw_content);
    } catch (e) {
      setSkillError(`읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSaveSkill = async () => {
    if (!agent || !editingSkillName) return;
    setSkillError("");
    try {
      await updateSkill(agent.folder_name, editingSkillName, editingSkillContent);
      setEditingSkillName(null);
      setEditingSkillContent("");
      await loadAgentSkills();
    } catch (e) {
      setSkillError(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteSkill = async (skillName: string) => {
    if (!agent) return;
    if (!confirm(`"${skillName}" 특기를 삭제하시겠습니까?`)) return;
    setSkillError("");
    try {
      await deleteSkill(agent.folder_name, skillName);
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
  );
}
