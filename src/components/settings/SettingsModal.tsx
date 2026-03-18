import { useState, useEffect, useRef } from "react";
import { Settings, X, RefreshCw, Wifi } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNetworkStore } from "../../stores/networkStore";
import { checkApiHealth, listModels, type ApiHealthCheckResponse } from "../../services/tauriCommands";
import { getNoProxy, setNoProxy } from "../../services/commands/apiCommands";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_THINKING_BUDGET } from "../../constants";
import type { UITheme } from "../../labels";
import ExportSection from "./ExportSection";
import CredentialManager from "./CredentialManager";

type Tab = "general" | "thinking" | "branding" | "credentials" | "backup" | "network";

export default function SettingsModal() {
  const store = useSettingsStore();
  const { isSettingsOpen, setIsSettingsOpen, saveSettings, settingsError } = store;

  const [tab, setTab] = useState<Tab>("general");
  const [tempApiKey, setTempApiKey] = useState("");
  const [clearStoredApiKey, setClearStoredApiKey] = useState(false);
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
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<ApiHealthCheckResponse | null>(null);
  const [healthError, setHealthError] = useState("");
  const [noProxyEnabled, setNoProxyEnabled] = useState(false);

  const network = useNetworkStore();
  const [networkToggleLoading, setNetworkToggleLoading] = useState(false);
  const [peerIdCopied, setPeerIdCopied] = useState(false);
  const hasEnabledBefore = useRef(localStorage.getItem("network_enabled") !== null);
  const [showConsent, setShowConsent] = useState(false);

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
      setClearStoredApiKey(false);
      setTempBaseUrl(store.baseUrl);
      setTempModelName(store.modelName);
      setTempThinkingEnabled(store.thinkingEnabled);
      setTempThinkingBudget(store.thinkingBudget);
      setTempCompanyName(store.companyName);
      setTempUITheme(store.uiTheme);
      setHealthResult(null);
      setHealthError("");
      setTab("general");
      fetchModels();
      getNoProxy().then(setNoProxyEnabled).catch(() => {});
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
      clearApiKey: clearStoredApiKey,
      baseUrl: tempBaseUrl,
      modelName: tempModelName,
      thinkingEnabled: tempThinkingEnabled,
      thinkingBudget: tempThinkingBudget,
    });
  };

  const handleHealthCheck = async () => {
    setHealthLoading(true);
    setHealthError("");
    setHealthResult(null);

    try {
      const result = await checkApiHealth({
        api_key: clearStoredApiKey ? "" : (tempApiKey || null),
        base_url: tempBaseUrl,
      });
      setHealthResult(result);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e));
    } finally {
      setHealthLoading(false);
    }
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
          <button
            className={`settings-tab ${tab === "network" ? "active" : ""}`}
            onClick={() => setTab("network")}
          >
            <Wifi size={14} />
            네트워크
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
                  placeholder={
                    clearStoredApiKey
                      ? "저장 시 기존 API 키가 삭제됩니다"
                      : store.hasStoredKey
                        ? "••••••••(설정됨, 변경하려면 입력)"
                        : tempBaseUrl && tempBaseUrl !== DEFAULT_BASE_URL
                          ? "프록시 서버는 비워둬도 됩니다"
                          : "sk-..."
                  }
                  value={tempApiKey}
                  onChange={(e) => {
                    setTempApiKey(e.target.value);
                    if (e.target.value) {
                      setClearStoredApiKey(false);
                    }
                    setHealthResult(null);
                    setHealthError("");
                  }}
                />
                {store.hasStoredKey && (
                  <div className="settings-inline-action-row">
                    <p className="form-text">
                      {clearStoredApiKey
                        ? "저장하면 백엔드에 저장된 API 키가 삭제됩니다."
                        : "필드를 비워두면 기존 API 키가 유지됩니다."}
                    </p>
                    <button
                      type="button"
                      className={`settings-inline-action ${clearStoredApiKey ? "danger" : ""}`}
                      onClick={() => {
                        setClearStoredApiKey((prev) => !prev);
                        setTempApiKey("");
                        setHealthResult(null);
                        setHealthError("");
                      }}
                    >
                      {clearStoredApiKey ? "키 유지" : "저장된 키 삭제"}
                    </button>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="baseUrl">Base URL (선택사항, vLLM / Local AI 등)</label>
                <input
                  id="baseUrl"
                  type="text"
                  placeholder={`${DEFAULT_BASE_URL} (기본값)`}
                  value={tempBaseUrl}
                  onChange={(e) => {
                    setTempBaseUrl(e.target.value);
                    setHealthResult(null);
                    setHealthError("");
                  }}
                />
                <div className="settings-proxy-row" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={noProxyEnabled}
                      onChange={async (e) => {
                        const val = e.target.checked;
                        setNoProxyEnabled(val);
                        try {
                          await setNoProxy(val);
                        } catch { /* ignore */ }
                      }}
                    />
                    프록시 우회 (Squid 등 프록시가 API 요청을 차단하는 경우)
                  </label>
                </div>
                <div className="settings-health-row">
                  <button
                    type="button"
                    className="btn-secondary settings-health-btn"
                    onClick={handleHealthCheck}
                    disabled={healthLoading}
                  >
                    {healthLoading ? "체크 중..." : "연결 확인"}
                  </button>
                  <p className="form-text">
                    /models 엔드포인트로 API 연결 상태를 확인합니다.
                  </p>
                </div>
                {healthResult && (
                  <p className={`form-text ${healthResult.ok ? "text-success" : "text-error"}`}>
                    {healthResult.ok ? "연결 성공" : `연결 실패 — ${healthResult.detail}`}
                  </p>
                )}
                {healthError && (
                  <p className="form-text text-error">연결 실패 — {healthError}</p>
                )}
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

          {tab === "network" && (
            <>
              {/* First-time consent */}
              {showConsent && (
                <div className="network-consent">
                  <p><strong>P2P 네트워크 안내</strong></p>
                  <p>
                    네트워크를 활성화하면 이 에이전트가 다른 에이전트와 직접 메시지를 주고받을 수 있습니다.
                    모든 통신은 암호화되며, 초대 코드를 교환한 상대만 연결됩니다.
                    수신된 메시지는 사용자 승인 후에만 처리됩니다.
                  </p>
                  <div className="network-consent-actions">
                    <button
                      className="btn-secondary"
                      onClick={() => setShowConsent(false)}
                    >
                      취소
                    </button>
                    <button
                      className="btn-primary"
                      onClick={async () => {
                        setShowConsent(false);
                        setNetworkToggleLoading(true);
                        try {
                          await network.startNetwork();
                          hasEnabledBefore.current = true;
                        } finally {
                          setNetworkToggleLoading(false);
                        }
                      }}
                    >
                      동의 및 활성화
                    </button>
                  </div>
                </div>
              )}

              <div className="form-group">
                <div className="toggle-row">
                  <label>P2P 네트워크</label>
                  <button
                    className={`toggle-switch ${network.networkEnabled ? "on" : ""}`}
                    disabled={networkToggleLoading}
                    onClick={async () => {
                      if (network.networkEnabled) {
                        setNetworkToggleLoading(true);
                        try {
                          await network.stopNetwork();
                        } finally {
                          setNetworkToggleLoading(false);
                        }
                      } else if (!hasEnabledBefore.current) {
                        setShowConsent(true);
                      } else {
                        setNetworkToggleLoading(true);
                        try {
                          await network.startNetwork();
                        } finally {
                          setNetworkToggleLoading(false);
                        }
                      }
                    }}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <p className="form-text">
                  다른 에이전트와 P2P 통신을 활성화합니다.
                </p>
              </div>

              <div className="form-group">
                <label>연결 상태</label>
                <div className="network-status-row">
                  <span className={`network-status-dot network-status-${network.status}`} />
                  <span>
                    {network.status === "dormant" && "비활성"}
                    {network.status === "starting" && "시작 중..."}
                    {network.status === "active" && "활성"}
                    {network.status === "stopping" && "중지 중..."}
                  </span>
                  {network.networkEnabled && (
                    <span className="network-peer-count">
                      연결된 피어: {network.contacts.filter((c) => c.status === "connected").length}
                    </span>
                  )}
                </div>
              </div>

              {network.peerId && (
                <div className="form-group">
                  <label>Peer ID</label>
                  <div className="peer-id-display">
                    <code>{network.peerId}</code>
                    <button
                      className="btn-secondary peer-id-copy-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(network.peerId!);
                        setPeerIdCopied(true);
                        setTimeout(() => setPeerIdCopied(false), 2000);
                      }}
                    >
                      {peerIdCopied ? "복사됨" : "복사"}
                    </button>
                  </div>
                </div>
              )}

              {network.error && (
                <p className="form-text text-error">{network.error}</p>
              )}
            </>
          )}
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
