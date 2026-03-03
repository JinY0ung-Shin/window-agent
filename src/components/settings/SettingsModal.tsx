import { useState, useEffect } from "react";
import { Settings, X } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";

type Tab = "general" | "thinking";

export default function SettingsModal() {
  const store = useSettingsStore();
  const { isSettingsOpen, setIsSettingsOpen, saveSettings } = store;

  const [tab, setTab] = useState<Tab>("general");
  const [tempApiKey, setTempApiKey] = useState("");
  const [tempBaseUrl, setTempBaseUrl] = useState("");
  const [tempModelName, setTempModelName] = useState("");
  const [tempThinkingEnabled, setTempThinkingEnabled] = useState(true);
  const [tempThinkingBudget, setTempThinkingBudget] = useState(4096);

  useEffect(() => {
    if (isSettingsOpen) {
      setTempApiKey(store.apiKey);
      setTempBaseUrl(store.baseUrl);
      setTempModelName(store.modelName);
      setTempThinkingEnabled(store.thinkingEnabled);
      setTempThinkingBudget(store.thinkingBudget);
      setTab("general");
    }
  }, [isSettingsOpen]);

  if (!isSettingsOpen) return null;

  const handleSave = () => {
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
        </div>

        <div className="modal-body">
          {tab === "general" && (
            <>
              <div className="form-group">
                <label htmlFor="apiKey">API Key (OpenAI 또는 Custom)</label>
                <input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="baseUrl">Base URL (선택사항, vLLM / Local AI 등)</label>
                <input
                  id="baseUrl"
                  type="text"
                  placeholder="https://api.openai.com/v1 (기본값)"
                  value={tempBaseUrl}
                  onChange={(e) => setTempBaseUrl(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="modelName">Model 이름</label>
                <input
                  id="modelName"
                  type="text"
                  placeholder="gpt-5.3-codex (기본값)"
                  value={tempModelName}
                  onChange={(e) => setTempModelName(e.target.value)}
                />
                <p className="form-text">
                  설정은 기기의 로컬 스토리지에만 안전하게 저장됩니다.
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
        </div>

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
