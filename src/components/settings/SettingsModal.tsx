import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import { Settings, X, RefreshCw, Wifi } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNetworkStore } from "../../stores/networkStore";
import { checkApiHealth, listModels, type ApiHealthCheckResponse } from "../../services/tauriCommands";
import { getNoProxy, setNoProxy } from "../../services/commands/apiCommands";
import { p2pGetListenPort, p2pSetListenPort, p2pGetConnectionInfo } from "../../services/commands/p2pCommands";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_THINKING_BUDGET } from "../../constants";
import type { UITheme } from "../../stores/settingsStore";
import type { Locale } from "../../i18n";
import { SUPPORTED_LOCALES } from "../../i18n";
import ExportSection from "./ExportSection";
import CredentialManager from "./CredentialManager";

type Tab = "general" | "thinking" | "branding" | "credentials" | "backup" | "network";

export default function SettingsModal() {
  const { t } = useTranslation("settings");
  const tn = useTranslation("network").t;
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
  const companyNameComposition = useCompositionInput(setTempCompanyName);

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
  const [configuredPort, setConfiguredPort] = useState<number | null>(null);
  const [activePort, setActivePort] = useState<number | null>(null);
  const [tempPort, setTempPort] = useState("");
  const [portSaving, setPortSaving] = useState(false);
  const [portSaved, setPortSaved] = useState(false);
  const [portError, setPortError] = useState("");

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const result = await listModels();
      setModels(result);
    } catch (e) {
      setModelsError(t("general.modelFetchError"));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (isSettingsOpen) {
      setTempApiKey("");
      setClearStoredApiKey(false);
      setTempBaseUrl(store.baseUrl || "");
      setTempModelName(store.modelName || "");
      setTempThinkingEnabled(store.thinkingEnabled ?? true);
      setTempThinkingBudget(store.thinkingBudget || DEFAULT_THINKING_BUDGET);
      setTempCompanyName(store.companyName || "");
      setTempUITheme(store.uiTheme || "org");
      setHealthResult(null);
      setHealthError("");
      setTab("general");
      fetchModels();
      getNoProxy().then(setNoProxyEnabled).catch(() => {});
      p2pGetListenPort().then((p) => {
        setConfiguredPort(p);
        setTempPort(p != null ? String(p) : "");
        setPortSaved(false);
        setPortError("");
      }).catch(() => {});
      p2pGetConnectionInfo().then((info) => {
        setActivePort(info.active_listen_port ?? null);
      }).catch(() => setActivePort(null));
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
            {t("title")}
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
            {t("tabs.general")}
          </button>
          <button
            className={`settings-tab ${tab === "thinking" ? "active" : ""}`}
            onClick={() => setTab("thinking")}
          >
            {t("tabs.thinking")}
          </button>
          <button
            className={`settings-tab ${tab === "branding" ? "active" : ""}`}
            onClick={() => setTab("branding")}
          >
            {t("tabs.branding")}
          </button>
          <button
            className={`settings-tab ${tab === "credentials" ? "active" : ""}`}
            onClick={() => setTab("credentials")}
          >
            {t("tabs.credentials")}
          </button>
          <button
            className={`settings-tab ${tab === "backup" ? "active" : ""}`}
            onClick={() => setTab("backup")}
          >
            {t("tabs.backup")}
          </button>
          <button
            className={`settings-tab ${tab === "network" ? "active" : ""}`}
            onClick={() => setTab("network")}
          >
            <Wifi size={14} />
            {t("tabs.network")}
          </button>
        </div>

        <div className="modal-body">
          {tab === "general" && (
            <>
              <div className="form-group">
                <label>{t("language.label")}</label>
                <div className="locale-selector">
                  {SUPPORTED_LOCALES.map((loc) => (
                    <button
                      key={loc}
                      className={`locale-option ${store.locale === loc ? "selected" : ""}`}
                      onClick={() => store.setLocale(loc as Locale)}
                    >
                      {t(`language.${loc}`)}
                    </button>
                  ))}
                </div>
              </div>

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
                        } catch { /* ignore */ }
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
            </>
          )}

          {tab === "thinking" && (
            <>
              <div className="form-group">
                <div className="toggle-row">
                  <label htmlFor="thinkingEnabled">{t("thinking.enableLabel")}</label>
                  <button
                    id="thinkingEnabled"
                    className={`toggle-switch ${tempThinkingEnabled ? "on" : ""}`}
                    onClick={() => setTempThinkingEnabled(!tempThinkingEnabled)}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <p className="form-text">
                  {t("thinking.enableHint")}
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="thinkingBudget">{t("thinking.budgetLabel")}</label>
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
                  {t("thinking.budgetHint")}
                </p>
              </div>
            </>
          )}

          {tab === "branding" && (
            <>
              <div className="form-group">
                <label htmlFor="companyName">{t("branding.companyNameLabel")}</label>
                <input
                  id="companyName"
                  type="text"
                  placeholder={t("branding.companyNamePlaceholder")}
                  value={tempCompanyName}
                  {...companyNameComposition.compositionProps}
                />
                <p className="form-text">
                  {t("branding.companyNameHint")}
                </p>
              </div>

              <div className="form-group">
                <label>{t("branding.themeLabel")}</label>
                <div className="toggle-row">
                  <span>{tempUITheme === "org" ? t("branding.themeOrg") : t("branding.themeClassic")}</span>
                  <button
                    className={`toggle-switch ${tempUITheme === "org" ? "on" : ""}`}
                    onClick={() => setTempUITheme(tempUITheme === "org" ? "classic" : "org")}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <p className="form-text">
                  {t("branding.themeHint")}
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
                <label htmlFor="listenPort">{tn("port.label")}</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    id="listenPort"
                    type="number"
                    min={1}
                    max={65535}
                    placeholder={tn("port.placeholder")}
                    value={tempPort}
                    onChange={(e) => {
                      setTempPort(e.target.value);
                      setPortSaved(false);
                      setPortError("");
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn-secondary"
                    disabled={portSaving}
                    onClick={async () => {
                      setPortError("");
                      const val = tempPort.trim();
                      const portNum = val === "" ? null : Number(val);
                      if (portNum != null && (isNaN(portNum) || portNum < 1 || portNum > 65535 || !Number.isInteger(portNum))) {
                        setPortError(tn("port.validationError"));
                        return;
                      }
                      setPortSaving(true);
                      try {
                        await p2pSetListenPort(portNum);
                        setConfiguredPort(portNum);
                        setPortSaved(true);
                      } catch (e) {
                        setPortError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setPortSaving(false);
                      }
                    }}
                  >
                    {portSaving ? t("common:saving") : t("common:save")}
                  </button>
                </div>
                {portSaved && (
                  <p className="form-text text-success">
                    {tn("port.saved")}
                  </p>
                )}
                {portError && (
                  <p className="form-text text-error">{portError}</p>
                )}
                {network.status === "active" && activePort != null && (
                  <p className="form-text">
                    {tn("port.activePort", { port: activePort })}
                    {configuredPort != null && activePort !== configuredPort && ` ${tn("port.portMismatch")}`}
                  </p>
                )}
                <p className="form-text">
                  {tn("port.hint")}
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
                  </span>
                  {network.networkEnabled && (
                    <span className="network-peer-count">
                      {tn("status.connectedPeers", { count: network.contacts.filter((c) => c.status === "connected").length })}
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
          )}
        </div>

        {settingsError && (
          <div className="modal-error">{settingsError}</div>
        )}

        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => setIsSettingsOpen(false)}>
            {t("common:cancel")}
          </button>
          <button className="btn-primary" onClick={handleSave}>
            {t("common:save")}
          </button>
        </div>
      </div>
    </div>
  );
}
