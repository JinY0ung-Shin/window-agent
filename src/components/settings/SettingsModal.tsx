import { useState, useEffect } from "react";
import { Settings, X } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";

export default function SettingsModal() {
  const { apiKey, baseUrl, modelName, isSettingsOpen, setIsSettingsOpen, saveSettings } =
    useSettingsStore();

  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [tempBaseUrl, setTempBaseUrl] = useState(baseUrl);
  const [tempModelName, setTempModelName] = useState(modelName);

  useEffect(() => {
    if (isSettingsOpen) {
      setTempApiKey(apiKey);
      setTempBaseUrl(baseUrl);
      setTempModelName(modelName);
    }
  }, [isSettingsOpen, apiKey, baseUrl, modelName]);

  if (!isSettingsOpen) return null;

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

        <div className="modal-body">
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
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => setIsSettingsOpen(false)}>
            취소
          </button>
          <button
            className="btn-primary"
            onClick={() => saveSettings(tempApiKey, tempBaseUrl, tempModelName)}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
