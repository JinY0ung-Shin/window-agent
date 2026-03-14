import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import {
  parseToolsMd,
  serializeToolsMd,
  canRoundTrip,
  type ToolDefinition,
} from "../../services/toolRegistry";
import type { ToolPermissionTier } from "../../services/types";

interface Props {
  rawContent: string;
  onChange: (content: string) => void;
}

interface ParamDraft {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ToolDraft {
  name: string;
  description: string;
  tier: ToolPermissionTier;
  params: ParamDraft[];
}

const TIER_INFO: Record<ToolPermissionTier, { label: string; color: string; desc: string }> = {
  auto: { label: "Auto", color: "#22c55e", desc: "자동 실행" },
  confirm: { label: "Confirm", color: "#f59e0b", desc: "확인 후 실행" },
  deny: { label: "Deny", color: "#ef4444", desc: "실행 거부" },
};

const PARAM_TYPES = ["string", "number", "boolean", "object", "array"];

function toolToOpenParams(tool: ToolDefinition): ParamDraft[] {
  const props = tool.parameters?.properties ?? {};
  const req: string[] = tool.parameters?.required ?? [];
  return (Object.entries(props) as [string, { type?: string; description?: string }][]).map(([name, def]) => ({
    name,
    type: def.type ?? "string",
    required: req.includes(name),
    description: def.description ?? "",
  }));
}

function draftsToToolDef(draft: ToolDraft): ToolDefinition {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const p of draft.params) {
    if (!p.name.trim()) continue;
    properties[p.name.trim()] = {
      type: p.type,
      description: p.description,
    };
    if (p.required) required.push(p.name.trim());
  }
  return {
    name: draft.name.trim(),
    description: draft.description,
    tier: draft.tier,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

const VALID_NAME_RE = /^\w+$/;

function validateDraft(draft: ToolDraft, tools: ToolDefinition[], editingIndex: number | null): string | null {
  const name = draft.name.trim();
  if (!name) return "도구 이름을 입력하세요";
  if (!VALID_NAME_RE.test(name)) return "도구 이름은 영문, 숫자, _ 만 사용 가능합니다";
  const isDuplicate = tools.some((t, i) => i !== editingIndex && t.name === name);
  if (isDuplicate) return `"${name}" 이름이 이미 존재합니다`;
  const paramNames = draft.params.map((p) => p.name.trim()).filter(Boolean);
  for (const pn of paramNames) {
    if (!VALID_NAME_RE.test(pn)) return `매개변수 "${pn}": 영문, 숫자, _ 만 사용 가능합니다`;
  }
  const uniqueParams = new Set(paramNames);
  if (uniqueParams.size !== paramNames.length) return "매개변수 이름이 중복됩니다";
  return null;
}

function emptyDraft(): ToolDraft {
  return { name: "", description: "", tier: "confirm", params: [] };
}

function emptyParam(): ParamDraft {
  return { name: "", type: "string", required: true, description: "" };
}

export default function ToolManagementPanel({ rawContent, onChange }: Props) {
  // Mode is determined once from the first non-empty rawContent, then locked
  const [modeLocked, setModeLocked] = useState(false);
  const [useStructured, setUseStructured] = useState(true);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<ToolDraft>(emptyDraft());
  const [rawText, setRawText] = useState(rawContent);
  const [showParams, setShowParams] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync content when rawContent changes (e.g. async persona load completes)
  // Mode (structured/raw) is only determined once from first non-empty content
  useEffect(() => {
    // Always sync raw text for fallback mode
    setRawText(rawContent);

    // Determine mode once when real content arrives
    if (!modeLocked) {
      const safe = canRoundTrip(rawContent);
      setUseStructured(safe);
      // Lock mode once we've seen non-empty content (or on second render for empty TOOLS.md)
      if (rawContent.trim() || modeLocked) {
        setModeLocked(true);
      }
    }

    // Always resync parsed tools for structured mode
    if (canRoundTrip(rawContent)) {
      setTools(parseToolsMd(rawContent));
    }

    // Reset form state on content change
    setEditingIndex(null);
    setShowAddForm(false);
    setDraft(emptyDraft());
    setShowParams(false);
    setValidationError(null);
  }, [rawContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync structured changes back to parent
  const syncTools = (updated: ToolDefinition[]) => {
    setTools(updated);
    onChange(serializeToolsMd(updated));
  };

  const handleSwitchToStructured = () => {
    setUseStructured(true);
    setModeLocked(true);
    setTools(parseToolsMd(rawContent));
  };

  const handleRawChange = (value: string) => {
    setRawText(value);
    onChange(value);
  };

  const startAdd = () => {
    setDraft(emptyDraft());
    setShowAddForm(true);
    setEditingIndex(null);
    setShowParams(false);
  };

  const startEdit = (index: number) => {
    const tool = tools[index];
    setDraft({
      name: tool.name,
      description: tool.description,
      tier: tool.tier,
      params: toolToOpenParams(tool),
    });
    setEditingIndex(index);
    setShowAddForm(false);
    setShowParams(toolToOpenParams(tool).length > 0);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setShowAddForm(false);
    setDraft(emptyDraft());
    setShowParams(false);
    setValidationError(null);
  };

  const saveDraft = () => {
    const error = validateDraft(draft, tools, editingIndex);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    const toolDef = draftsToToolDef(draft);
    let updated: ToolDefinition[];
    if (editingIndex !== null) {
      updated = tools.map((t, i) => (i === editingIndex ? toolDef : t));
    } else {
      updated = [...tools, toolDef];
    }
    syncTools(updated);
    cancelEdit();
  };

  const deleteTool = (index: number) => {
    syncTools(tools.filter((_, i) => i !== index));
    if (editingIndex === index) cancelEdit();
  };

  const addParam = () => {
    setDraft({ ...draft, params: [...draft.params, emptyParam()] });
    setShowParams(true);
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

  // Fallback: raw editor
  if (!useStructured) {
    return (
      <div className="tool-mgmt-panel">
        <div className="tool-fallback-warning">
          <AlertTriangle size={14} />
          <span>TOOLS.md에 수동 편집된 내용이 있어 구조화된 편집기를 사용할 수 없습니다.</span>
          <button className="btn-secondary" onClick={handleSwitchToStructured}>
            구조화된 편집기로 전환 (내용이 변환됩니다)
          </button>
        </div>
        <textarea
          className="persona-editor"
          value={rawText}
          onChange={(e) => handleRawChange(e.target.value)}
          placeholder="TOOLS.md 마크다운 형식으로 도구를 정의합니다"
          spellCheck={false}
        />
      </div>
    );
  }

  const isEditing = editingIndex !== null || showAddForm;

  return (
    <div className="tool-mgmt-panel">
      {isEditing ? (
        /* ── Add / Edit Form ── */
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

            {/* Parameters section */}
            <div className="form-group">
              <button
                className="tool-params-toggle"
                onClick={() => setShowParams(!showParams)}
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
        /* ── Tool List ── */
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
              도구를 추가하면 에이전트가 외부 기능을 실행할 수 있습니다.
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
