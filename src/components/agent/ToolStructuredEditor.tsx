import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ToolDefinition } from "../../services/toolRegistry";
import type { ToolPermissionTier } from "../../services/types";
import {
  type ToolDraft,
  type ParamDraft,
  toolToOpenParams,
  draftsToToolDef,
  validateDraft,
  emptyDraft,
  emptyParam,
} from "../../services/toolRegistry";

const TIER_INFO: Record<ToolPermissionTier, { label: string; color: string; desc: string }> = {
  auto: { label: "Auto", color: "#22c55e", desc: "자동 실행" },
  confirm: { label: "Confirm", color: "#f59e0b", desc: "확인 후 실행" },
  deny: { label: "Deny", color: "#ef4444", desc: "실행 거부" },
};

const PARAM_TYPES = ["string", "number", "boolean", "object", "array"];

interface Props {
  tools: ToolDefinition[];
  onToolsChange: (tools: ToolDefinition[]) => void;
}

interface EditState {
  editingIndex: number | null;
  showAddForm: boolean;
  draft: ToolDraft;
  showParams: boolean;
  validationError: string | null;
}

import { useState } from "react";
import { useLabels } from "../../hooks/useLabels";

export default function ToolStructuredEditor({ tools, onToolsChange }: Props) {
  const labels = useLabels();
  const [editState, setEditState] = useState<EditState>({
    editingIndex: null,
    showAddForm: false,
    draft: emptyDraft(),
    showParams: false,
    validationError: null,
  });

  const { editingIndex, showAddForm, draft, showParams, validationError } = editState;

  const updateEdit = (patch: Partial<EditState>) =>
    setEditState((prev) => ({ ...prev, ...patch }));

  const startAdd = () => {
    updateEdit({
      draft: emptyDraft(),
      showAddForm: true,
      editingIndex: null,
      showParams: false,
      validationError: null,
    });
  };

  const startEdit = (index: number) => {
    const tool = tools[index];
    const params = toolToOpenParams(tool);
    updateEdit({
      draft: { name: tool.name, description: tool.description, tier: tool.tier, params },
      editingIndex: index,
      showAddForm: false,
      showParams: params.length > 0,
      validationError: null,
    });
  };

  const cancelEdit = () => {
    updateEdit({
      editingIndex: null,
      showAddForm: false,
      draft: emptyDraft(),
      showParams: false,
      validationError: null,
    });
  };

  const saveDraft = () => {
    const error = validateDraft(draft, tools, editingIndex);
    if (error) {
      updateEdit({ validationError: error });
      return;
    }
    const toolDef = draftsToToolDef(draft);
    let updated: ToolDefinition[];
    if (editingIndex !== null) {
      updated = tools.map((t, i) => (i === editingIndex ? toolDef : t));
    } else {
      updated = [...tools, toolDef];
    }
    onToolsChange(updated);
    cancelEdit();
  };

  const deleteTool = (index: number) => {
    onToolsChange(tools.filter((_, i) => i !== index));
    if (editingIndex === index) cancelEdit();
  };

  const setDraft = (d: ToolDraft) => updateEdit({ draft: d });

  const addParam = () => {
    setDraft({ ...draft, params: [...draft.params, emptyParam()] });
    updateEdit({ showParams: true, draft: { ...draft, params: [...draft.params, emptyParam()] } });
  };

  const updateParam = (pIndex: number, field: keyof ParamDraft, value: any) => {
    const params = draft.params.map((p, i) =>
      i === pIndex ? { ...p, [field]: value } : p,
    );
    setDraft({ ...draft, params });
  };

  const removeParam = (pIndex: number) => {
    setDraft({ ...draft, params: draft.params.filter((_, i) => i !== pIndex) });
  };

  const isEditing = editingIndex !== null || showAddForm;

  return (
    <div className="tool-mgmt-panel">
      {isEditing ? (
        <div className="tool-form">
          <div className="tool-form-header">
            <span className="tool-form-title">
              {editingIndex !== null ? "도구 편집" : "새 도구 추가"}
            </span>
            <div className="tool-form-actions">
              <button className="btn-secondary" onClick={cancelEdit}>
                <X size={14} /> 취소
              </button>
              <button
                className="btn-primary"
                onClick={saveDraft}
                disabled={!draft.name.trim()}
              >
                <Check size={14} /> 저장
              </button>
            </div>
          </div>

          <div className="tool-form-body">
            <div className="form-group">
              <label>도구 이름</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="예: web_search"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>설명</label>
              <input
                type="text"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="이 도구가 하는 일을 설명합니다"
              />
            </div>

            <div className="form-group">
              <label>권한 등급</label>
              <div className="tool-tier-selector">
                {(Object.keys(TIER_INFO) as ToolPermissionTier[]).map((t) => (
                  <button
                    key={t}
                    className={`tool-tier-option ${draft.tier === t ? "active" : ""}`}
                    style={
                      draft.tier === t
                        ? { borderColor: TIER_INFO[t].color, color: TIER_INFO[t].color }
                        : undefined
                    }
                    onClick={() => setDraft({ ...draft, tier: t })}
                  >
                    <span className="tool-tier-label">{TIER_INFO[t].label}</span>
                    <span className="tool-tier-desc">{TIER_INFO[t].desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <button
                className="tool-params-toggle"
                onClick={() => updateEdit({ showParams: !showParams })}
              >
                {showParams ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>매개변수 ({draft.params.length}개)</span>
              </button>

              {showParams && (
                <div className="tool-params-list">
                  {draft.params.map((p, i) => (
                    <div key={i} className="tool-param-row">
                      <input
                        type="text"
                        value={p.name}
                        onChange={(e) => updateParam(i, "name", e.target.value)}
                        placeholder="이름"
                        className="tool-param-name"
                      />
                      <select
                        value={p.type}
                        onChange={(e) => updateParam(i, "type", e.target.value)}
                        className="tool-param-type"
                      >
                        {PARAM_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <button
                        className={`tool-param-req ${p.required ? "required" : "optional"}`}
                        onClick={() => updateParam(i, "required", !p.required)}
                        title={p.required ? "필수" : "선택"}
                      >
                        {p.required ? "필수" : "선택"}
                      </button>
                      <input
                        type="text"
                        value={p.description}
                        onChange={(e) => updateParam(i, "description", e.target.value)}
                        placeholder="설명"
                        className="tool-param-desc"
                      />
                      <button
                        className="tool-param-remove"
                        onClick={() => removeParam(i)}
                        title="삭제"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button className="btn-secondary tool-param-add" onClick={addParam}>
                    <Plus size={12} /> 매개변수 추가
                  </button>
                </div>
              )}
            </div>
          </div>

          {validationError && (
            <div className="skill-error">{validationError}</div>
          )}
        </div>
      ) : (
        <>
          <div className="tool-list-header">
            <span className="tool-list-count">
              {tools.length === 0 ? "등록된 도구 없음" : `도구 ${tools.length}개`}
            </span>
            <button className="btn-secondary tool-add-btn" onClick={startAdd}>
              <Plus size={14} /> 새 도구 추가
            </button>
          </div>

          {tools.length === 0 && (
            <div className="tool-empty">
              {labels.toolAgentCapability}
            </div>
          )}

          <div className="tool-card-list">
            {tools.map((tool, index) => (
              <div key={`${tool.name}-${index}`} className="tool-card">
                <div className="tool-card-main">
                  <div className="tool-card-info">
                    <span className="tool-card-name">{tool.name}</span>
                    <span className="tool-card-desc">
                      {tool.description || "(설명 없음)"}
                    </span>
                  </div>
                  <span
                    className={`tool-tier-badge tier-${tool.tier}`}
                    title={TIER_INFO[tool.tier].desc}
                  >
                    {TIER_INFO[tool.tier].label}
                  </span>
                </div>
                {Object.keys(tool.parameters?.properties ?? {}).length > 0 && (
                  <div className="tool-card-params">
                    {(Object.entries(tool.parameters.properties) as [string, { type?: string }][]).map(([pName, pDef]) => (
                      <span key={pName} className="tool-card-param-chip">
                        {pName}
                        <span className="tool-card-param-type">:{pDef.type}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="tool-card-actions">
                  <button onClick={() => startEdit(index)} title="편집">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => deleteTool(index)} title="삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
