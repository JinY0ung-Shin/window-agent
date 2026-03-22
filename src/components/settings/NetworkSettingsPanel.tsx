import { useState, useEffect, forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNetworkStore } from "../../stores/networkStore";
import { checkApiHealth, listModels, type ApiHealthCheckResponse } from "../../services/tauriCommands";
import { getNoProxy, setNoProxy } from "../../services/commands/apiCommands";
import { relayGetRelayUrl, relaySetRelayUrl } from "../../services/commands/relayCommands";
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

    /* ── Agent network state ── */
    const [networkToggleLoading, setNetworkToggleLoading] = useState(false);
    const [peerIdCopied, setPeerIdCopied] = useState(false);
    const hasEnabledBefore = useRef(localStorage.getItem("network_enabled") !== null);
    const [showConsent, setShowConsent] = useState(false);
    const [tempRelayUrl, setTempRelayUrl] = useState("");
    const [relaySaving, setRelaySaving] = useState(false);
    const [relaySaved, setRelaySaved] = useState(false);
    const [relayError, setRelayError] = useState("");

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

        /* Network init */
        relayGetRelayUrl().then((url) => {
          setTempRelayUrl(url);
          setRelaySaved(false);
          setRelayError("");
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
                onClick={() => {
                  navigator.clipboard.writeText(network.peerId!);
                  setPeerIdCopied(true);
                  setTimeout(() => setPeerIdCopied(false), 2000);
                }}
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
