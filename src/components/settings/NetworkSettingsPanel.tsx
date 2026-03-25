import { useState, useEffect, forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useClipboardFeedback } from "../../hooks/useClipboardFeedback";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNetworkStore } from "../../stores/networkStore";
import { checkApiHealth, listModels, type ApiHealthCheckResponse } from "../../services/tauriCommands";
import { getNoProxy, setNoProxy, getBrowserProxy, setBrowserProxy, detectSystemProxy } from "../../services/commands/apiCommands";
import { relayGetRelayUrl, relaySetRelayUrl, relayGetAllowedTools, relaySetAllowedTools } from "../../services/commands/relayCommands";
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from "../../constants";
import { logger } from "../../services/logger";
import { toErrorMessage } from "../../utils/errorUtils";

export interface NetworkPanelValues {
  apiKey: string;
  clearApiKey: boolean;
  baseUrl: string;
  modelName: string;
}

export interface NetworkSettingsPanelRef {
  getValues: () => NetworkPanelValues;
}

interface Props {
  isOpen: boolean;
}

const NetworkSettingsPanel = forwardRef<NetworkSettingsPanelRef, Props>(
  function NetworkSettingsPanel({ isOpen }, ref) {
    const { t } = useTranslation("settings");
    const tn = useTranslation("network").t;
    const store = useSettingsStore();
    const network = useNetworkStore();

    /* ── API server state ── */
    const [tempApiKey, setTempApiKey] = useState("");
    const [clearStoredApiKey, setClearStoredApiKey] = useState(false);
    const [tempBaseUrl, setTempBaseUrl] = useState("");
    const [tempModelName, setTempModelName] = useState("");
    const [models, setModels] = useState<string[]>([]);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [modelsError, setModelsError] = useState("");
    const [healthLoading, setHealthLoading] = useState(false);
    const [healthResult, setHealthResult] = useState<ApiHealthCheckResponse | null>(null);
    const [healthError, setHealthError] = useState("");
    const [noProxyEnabled, setNoProxyEnabled] = useState(false);

    /* ── Browser proxy state ── */
    const [browserProxy, setBrowserProxyState] = useState("");
    const [browserProxySaving, setBrowserProxySaving] = useState(false);
    const [browserProxySaved, setBrowserProxySaved] = useState(false);
    const [browserProxyDetecting, setBrowserProxyDetecting] = useState(false);
    const [browserProxyDetectMsg, setBrowserProxyDetectMsg] = useState("");

    /* ── Agent network state ── */
    const [networkToggleLoading, setNetworkToggleLoading] = useState(false);
    const { copied: peerIdCopied, copy: copyPeerId } = useClipboardFeedback(2000);
    const hasEnabledBefore = useRef(localStorage.getItem("network_enabled") !== null);
    const [showConsent, setShowConsent] = useState(false);
    const [tempRelayUrl, setTempRelayUrl] = useState("");
    const [relaySaving, setRelaySaving] = useState(false);
    const [relaySaved, setRelaySaved] = useState(false);
    const [relayError, setRelayError] = useState("");

    /* ── Relay tools state ── */
    const ALL_RELAY_TOOLS = [
      { name: "read_file", label: "Read File" },
      { name: "list_directory", label: "List Directory" },
      { name: "write_file", label: "Write File" },
      { name: "delete_file", label: "Delete File" },
      { name: "web_search", label: "Web Search" },
      { name: "http_request", label: "HTTP Request" },
      { name: "self_inspect", label: "Self Inspect" },
      { name: "manage_schedule", label: "Manage Schedule" },
    ];
    const DEFAULT_RELAY_TOOLS = ["read_file", "list_directory", "web_search", "http_request", "self_inspect"];
    const [relayTools, setRelayTools] = useState<string[]>(DEFAULT_RELAY_TOOLS);
    const [relayToolsSaving, setRelayToolsSaving] = useState(false);
    const [relayToolsSaved, setRelayToolsSaved] = useState(false);

    const fetchModels = async () => {
      setModelsLoading(true);
      setModelsError("");
      try {
        const result = await listModels();
        setModels(result);
      } catch {
        setModelsError(t("general.modelFetchError"));
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
    };

    useEffect(() => {
      if (isOpen) {
        /* API init */
        setTempApiKey("");
        setClearStoredApiKey(false);
        setTempBaseUrl(store.baseUrl || "");
        setTempModelName(store.modelName || "");
        setHealthResult(null);
        setHealthError("");
        fetchModels();
        getNoProxy().then(setNoProxyEnabled).catch((e) => logger.debug("Failed to get proxy setting", e));
        getBrowserProxy().then((p) => {
          setBrowserProxyState(p);
          setBrowserProxySaved(false);
          setBrowserProxyDetectMsg("");
        }).catch((e) => logger.debug("Failed to get browser proxy", e));

        /* Network init */
        relayGetRelayUrl().then((url) => {
          setTempRelayUrl(url);
          setRelaySaved(false);
          setRelayError("");
        }).catch(() => {});

        relayGetAllowedTools().then((tools) => {
          if (tools.length > 0) setRelayTools(tools);
          else setRelayTools(DEFAULT_RELAY_TOOLS);
          setRelayToolsSaved(false);
        }).catch(() => {});
      }
    }, [isOpen]);

    useImperativeHandle(ref, () => ({
      getValues: () => ({
        apiKey: tempApiKey,
        clearApiKey: clearStoredApiKey,
        baseUrl: tempBaseUrl,
        modelName: tempModelName,
      }),
    }));

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
        setHealthError(toErrorMessage(e));
      } finally {
        setHealthLoading(false);
      }
    };

    return (
      <>
        {/* ═══════ API 서버 섹션 ═══════ */}
        <h3 className="settings-section-title">{t("sections.apiServer")}</h3>

        <div className="form-group">
          <label htmlFor="apiKey">{t("general.apiKeyLabel")}</label>
          <input
            id="apiKey"
            type="password"
            placeholder={
              clearStoredApiKey
                ? t("general.apiKeyPlaceholderClearing")
                : store.hasStoredKey
                  ? t("general.apiKeyPlaceholderStored")
                  : tempBaseUrl && tempBaseUrl !== DEFAULT_BASE_URL
                    ? t("general.apiKeyPlaceholderProxy")
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
                  ? t("general.apiKeyClearWarning")
                  : t("general.apiKeyKeepHint")}
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
                {clearStoredApiKey ? t("general.keepKey") : t("general.deleteStoredKey")}
              </button>
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="baseUrl">{t("general.baseUrlLabel")}</label>
          <input
            id="baseUrl"
            type="text"
            placeholder={t("general.baseUrlDefault", { url: DEFAULT_BASE_URL })}
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
                  } catch (e) { logger.debug("Failed to set proxy bypass", e); }
                }}
              />
              {t("general.proxyBypass")}
            </label>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="browserProxy">{t("general.browserProxyLabel")}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="browserProxy"
              type="text"
              placeholder={t("general.browserProxyPlaceholder")}
              value={browserProxy}
              onChange={(e) => {
                setBrowserProxyState(e.target.value);
                setBrowserProxySaved(false);
                setBrowserProxyDetectMsg("");
              }}
              style={{ flex: 1 }}
            />
            <button
              className="btn-secondary"
              disabled={browserProxySaving}
              onClick={async () => {
                setBrowserProxySaving(true);
                try {
                  await setBrowserProxy(browserProxy.trim());
                  setBrowserProxySaved(true);
                } catch (e) {
                  logger.debug("Failed to save browser proxy", e);
                } finally {
                  setBrowserProxySaving(false);
                }
              }}
            >
              {browserProxySaving ? t("common:saving") : t("common:save")}
            </button>
            <button
              className="btn-secondary"
              disabled={browserProxyDetecting}
              onClick={async () => {
                setBrowserProxyDetecting(true);
                setBrowserProxyDetectMsg("");
                try {
                  const detected = await detectSystemProxy();
                  if (detected) {
                    setBrowserProxyState(detected);
                    setBrowserProxyDetectMsg(t("general.browserProxyDetected"));
                  } else {
                    setBrowserProxyDetectMsg(t("general.browserProxyNotDetected"));
                  }
                } catch (e) {
                  logger.debug("Failed to detect system proxy", e);
                  setBrowserProxyDetectMsg(t("general.browserProxyNotDetected"));
                } finally {
                  setBrowserProxyDetecting(false);
                }
              }}
            >
              {t("general.browserProxyDetect")}
            </button>
          </div>
          {browserProxySaved && (
            <p className="form-text text-success">{t("general.browserProxySaved")}</p>
          )}
          {browserProxyDetectMsg && (
            <p className="form-text">{browserProxyDetectMsg}</p>
          )}
          <p className="form-text">{t("general.browserProxyHint")}</p>
        </div>

        <div className="form-group">
          <div className="settings-health-row">
            <button
              type="button"
              className="btn-secondary settings-health-btn"
              onClick={handleHealthCheck}
              disabled={healthLoading}
            >
              {healthLoading ? t("general.healthChecking") : t("general.healthCheck")}
            </button>
            <p className="form-text">
              {t("general.healthCheckHint")}
            </p>
          </div>
          {healthResult && (
            <p className={`form-text ${healthResult.ok ? "text-success" : "text-error"}`}>
              {healthResult.ok ? t("general.healthSuccess") : t("general.healthFailed", { detail: healthResult.detail })}
            </p>
          )}
          {healthError && (
            <p className="form-text text-error">{t("general.healthFailed", { detail: healthError })}</p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="modelName">
            {t("general.modelLabel")}
            <button
              type="button"
              className="model-refresh-btn"
              onClick={fetchModels}
              disabled={modelsLoading}
              title={t("general.modelRefreshTitle")}
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
              placeholder={modelsError || t("general.modelDefault", { model: DEFAULT_MODEL })}
              value={tempModelName}
              onChange={(e) => setTempModelName(e.target.value)}
            />
          )}
          <p className="form-text">
            {t("general.apiKeySecurityHint")}
          </p>
        </div>

        {/* ═══════ 에이전트 네트워크 섹션 ═══════ */}
        <h3 className="settings-section-title">{t("sections.agentNetwork")}</h3>

        {showConsent && (
          <div className="network-consent">
            <p><strong>{tn("consent.title")}</strong></p>
            <p>
              {tn("consent.description")}
            </p>
            <div className="network-consent-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowConsent(false)}
              >
                {tn("consent.cancel")}
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
                {tn("consent.agreeAndEnable")}
              </button>
            </div>
          </div>
        )}

        <div className="form-group">
          <div className="toggle-row">
            <label>{tn("toggle.label")}</label>
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
            {tn("toggle.hint")}
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="relayUrl">{tn("relay.label")}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="relayUrl"
              type="text"
              placeholder={tn("relay.placeholder")}
              value={tempRelayUrl}
              onChange={(e) => {
                setTempRelayUrl(e.target.value);
                setRelaySaved(false);
                setRelayError("");
              }}
              style={{ flex: 1 }}
            />
            <button
              className="btn-secondary"
              disabled={relaySaving}
              onClick={async () => {
                setRelayError("");
                const val = tempRelayUrl.trim();
                if (val && !val.startsWith("ws://") && !val.startsWith("wss://")) {
                  setRelayError(tn("relay.validationError"));
                  return;
                }
                setRelaySaving(true);
                try {
                  await relaySetRelayUrl(val);
                  setRelaySaved(true);
                } catch (e) {
                  setRelayError(toErrorMessage(e));
                } finally {
                  setRelaySaving(false);
                }
              }}
            >
              {relaySaving ? t("common:saving") : t("common:save")}
            </button>
          </div>
          {relaySaved && (
            <p className="form-text text-success">
              {tn("relay.saved")}
            </p>
          )}
          {relayError && (
            <p className="form-text text-error">{relayError}</p>
          )}
          <p className="form-text">
            {tn("relay.hint")}
          </p>
        </div>

        <div className="form-group">
          <label>{tn("tools.label")}</label>
          <p className="form-text" style={{ marginBottom: 8 }}>
            {tn("tools.hint")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ALL_RELAY_TOOLS.map((tool) => (
              <label key={tool.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={relayTools.includes(tool.name)}
                  onChange={(e) => {
                    setRelayToolsSaved(false);
                    if (e.target.checked) {
                      setRelayTools((prev) => [...prev, tool.name]);
                    } else {
                      setRelayTools((prev) => prev.filter((t) => t !== tool.name));
                    }
                  }}
                />
                {tool.label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              className="btn-secondary"
              disabled={relayToolsSaving}
              onClick={async () => {
                setRelayToolsSaving(true);
                try {
                  await relaySetAllowedTools(relayTools);
                  setRelayToolsSaved(true);
                } catch (e) {
                  logger.debug("Failed to save relay tools", e);
                } finally {
                  setRelayToolsSaving(false);
                }
              }}
            >
              {relayToolsSaving ? t("common:saving") : t("common:save")}
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setRelayTools(DEFAULT_RELAY_TOOLS);
                setRelayToolsSaved(false);
              }}
            >
              {tn("tools.reset")}
            </button>
          </div>
          {relayToolsSaved && (
            <p className="form-text text-success">
              {tn("tools.saved")}
            </p>
          )}
        </div>

        <div className="form-group">
          <label>{tn("status.label")}</label>
          <div className="network-status-row">
            <span className={`network-status-dot network-status-${network.status}`} />
            <span>
              {network.status === "dormant" && tn("status.dormant")}
              {network.status === "starting" && tn("status.starting")}
              {network.status === "active" && tn("status.active")}
              {network.status === "stopping" && tn("status.stopping")}
              {network.status === "reconnecting" && tn("status.reconnecting")}
            </span>
            {network.networkEnabled && (
              <span className="network-peer-count">
                {tn("status.connectedPeers", { count: network.connectedPeers.size })}
              </span>
            )}
          </div>
        </div>

        {network.peerId && (
          <div className="form-group">
            <label>{tn("peerId.label")}</label>
            <div className="peer-id-display">
              <code>{network.peerId}</code>
              <button
                className="btn-secondary peer-id-copy-btn"
                onClick={() => copyPeerId(network.peerId!)}
              >
                {peerIdCopied ? tn("peerId.copied") : tn("peerId.copy")}
              </button>
            </div>
          </div>
        )}

        {network.error && (
          <p className="form-text text-error">{network.error}</p>
        )}
      </>
    );
  },
);

export default NetworkSettingsPanel;
