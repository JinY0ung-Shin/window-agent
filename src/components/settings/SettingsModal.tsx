import { useState, useEffect, useRef } from "react";
import { Settings, X, RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { listModels } from "../../services/tauriCommands";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_THINKING_BUDGET } from "../../constants";
import type { UITheme } from "../../labels";
import ExportSection from "./ExportSection";
import CredentialManager from "./CredentialManager";

type Tab = "general" | "thinking" | "branding" | "credentials" | "backup";

export default function SettingsModal() {
  const store = useSettingsStore();
  const { isSettingsOpen, setIsSettingsOpen, saveSettings, settingsError } = store;

  const [tab, setTab] = useState<Tab>("general");
  const [tempApiKey, setTempApiKey] = useState("");
  const [tempBaseUrl, setTempBaseUrl] = useState("");
  const [tempModelName, setTempModelName] = useState("");
  const [tempThinkingEnabled, setTempThinkingEnabled] = useState(true);
  const [tempThinkingBudget, setTempThinkingBudget] = useState(DEFAULT_THINKING_BUDGET);
  const [tempCompanyName, setTempCompanyName] = useState("");
  const [tempUITheme, setTempUITheme] = useState<UITheme>("org");
  const isCompanyNameComposing = useRef(false);

  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const result = await listModels();
      setModels(result);
    } catch (e) {
      setModelsError("모델 목록을 불러올 수 없습니다");
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (isSettingsOpen) {
      setTempApiKey("");
      setTempBaseUrl(store.baseUrl);
      setTempModelName(store.modelName);
      setTempThinkingEnabled(store.thinkingEnabled);
      setTempThinkingBudget(store.thinkingBudget);
      setTempCompanyName(store.companyName);
      setTempUITheme(store.uiTheme);
      setTab("general");
      fetchModels();
    }
  }, [isSettingsOpen]);

  if (!isSettingsOpen) return null;

  const handleSave = () => {
    // Branding settings are localStorage-only (cannot fail), so apply immediately.
    // API settings go through async saveSettings() which may fail independently.
    store.setCompanyName(tempCompanyName.trim());
    store.setUITheme(tempUITheme);
    saveSettings({
      apiKey: tempApiKey,
      baseUrl: tempBaseUrl,
      modelName: tempModelName,
      thinkingEnabled: tempThinkingEnabled,
      thinkingBudget: tempThinkingBudget,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>
            <Settings size={24} color="#6366f1" />
            환경 설정
          </h2>
          <button className="close-button" onClick={() => setIsSettingsOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${tab === "general" ? "active" : ""}`}
            onClick={() => setTab("general")}
          >
            일반
          </button>
          <button
            className={`settings-tab ${tab === "thinking" ? "active" : ""}`}
            onClick={() => setTab("thinking")}
          >
            추론 (Thinking)
          </button>
          <button
            className={`settings-tab ${tab === "branding" ? "active" : ""}`}
            onClick={() => setTab("branding")}
          >
            브랜딩
          </button>
          <button
            className={`settings-tab ${tab === "credentials" ? "active" : ""}`}
            onClick={() => setTab("credentials")}
          >
            보안 키
          </button>
          <button
            className={`settings-tab ${tab === "backup" ? "active" : ""}`}
            onClick={() => setTab("backup")}
          >
            백업/복원
          </button>
        </div>

        <div className="modal-body">
          {tab === "general" && (
            <>
              <div className="form-group">
                <label htmlFor="apiKey">API Key (OpenAI 또는 Custom)</label>
                <input
                  id="apiKey"
                  type="password"
                  placeholder={store.hasApiKey ? "••••••••(설정됨, 변경하려면 입력)" : "sk-..."}
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="baseUrl">Base URL (선택사항, vLLM / Local AI 등)</label>
                <input
                  id="baseUrl"
                  type="text"
                  placeholder={`${DEFAULT_BASE_URL} (기본값)`}
                  value={tempBaseUrl}
                  onChange={(e) => setTempBaseUrl(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="modelName">
                  모델
                  <button
                    type="button"
                    className="model-refresh-btn"
                    onClick={fetchModels}
                    disabled={modelsLoading}
                    title="모델 목록 새로고침"
                  >
                    <RefreshCw size={14} className={modelsLoading ? "spinning" : ""} />
                  </button>
                </label>
                {models.length > 0 ? (
                  <select
                    id="modelName"
                    value={tempModelName}
                    onChange={(e) => setTempModelName(e.target.value)}
                  >
                    {!models.includes(tempModelName) && tempModelName && (
                      <option value={tempModelName}>{tempModelName}</option>
                    )}
                    {models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="modelName"
                    type="text"
                    placeholder={modelsError || `${DEFAULT_MODEL} (기본값)`}
                    value={tempModelName}
                    onChange={(e) => setTempModelName(e.target.value)}
                  />
                )}
                <p className="form-text">
                  API 키는 백엔드에서만 관리되며 브라우저에 저장되지 않습니다.
                </p>
              </div>
            </>
          )}

          {tab === "thinking" && (
            <>
              <div className="form-group">
                <div className="toggle-row">
                  <label htmlFor="thinkingEnabled">Thinking 모드 사용</label>
                  <button
                    id="thinkingEnabled"
                    className={`toggle-switch ${tempThinkingEnabled ? "on" : ""}`}
                    onClick={() => setTempThinkingEnabled(!tempThinkingEnabled)}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <p className="form-text">
                  활성화하면 모델이 응답 전에 내부 추론을 수행합니다. 지원하지 않는 모델에서는 자동으로 일반 모드로 전환됩니다.
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="thinkingBudget">Budget Tokens</label>
                <input
                  id="thinkingBudget"
                  type="number"
                  min={256}
                  max={32768}
                  step={256}
                  value={tempThinkingBudget}
                  onChange={(e) => setTempThinkingBudget(Number(e.target.value))}
                  disabled={!tempThinkingEnabled}
                />
                <input
                  type="range"
                  min={256}
                  max={32768}
                  step={256}
                  value={tempThinkingBudget}
                  onChange={(e) => setTempThinkingBudget(Number(e.target.value))}
                  disabled={!tempThinkingEnabled}
                  className="budget-slider"
                />
                <p className="form-text">
                  모델이 추론에 사용할 수 있는 최대 토큰 수입니다. 높을수록 더 깊이 생각하지만 응답이 느려집니다.
                </p>
              </div>
            </>
          )}

          {tab === "branding" && (
            <>
              <div className="form-group">
                <label htmlFor="companyName">회사/워크스페이스 이름</label>
                <input
                  id="companyName"
                  type="text"
                  placeholder="예: 우리 회사"
                  value={tempCompanyName}
                  onChange={(e) => setTempCompanyName(e.target.value)}
                  onCompositionStart={() => { isCompanyNameComposing.current = true; }}
                  onCompositionEnd={(e) => {
                    isCompanyNameComposing.current = false;
                    setTempCompanyName(e.currentTarget.value);
                  }}
                />
                <p className="form-text">
                  사이드바 헤더와 환영 화면에 표시됩니다.
                </p>
              </div>

              <div className="form-group">
                <label>UI 테마</label>
                <div className="toggle-row">
                  <span>{tempUITheme === "org" ? "조직 운영" : "클래식"}</span>
                  <button
                    className={`toggle-switch ${tempUITheme === "org" ? "on" : ""}`}
                    onClick={() => setTempUITheme(tempUITheme === "org" ? "classic" : "org")}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <p className="form-text">
                  클래식: 에이전트 중심 UI / 조직 운영: 회사·직원 메타포
                </p>
              </div>
            </>
          )}

          {tab === "credentials" && <CredentialManager />}

          {tab === "backup" && <ExportSection />}
        </div>

        {settingsError && (
          <div className="modal-error">{settingsError}</div>
        )}

        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => setIsSettingsOpen(false)}>
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
