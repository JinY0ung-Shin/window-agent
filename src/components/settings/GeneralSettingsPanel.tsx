import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { checkApiHealth, listModels, type ApiHealthCheckResponse } from "../../services/tauriCommands";
import { getNoProxy, setNoProxy } from "../../services/commands/apiCommands";
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from "../../constants";
import type { Locale } from "../../i18n";
import { SUPPORTED_LOCALES } from "../../i18n";
import { logger } from "../../services/logger";

export interface GeneralPanelValues {
  apiKey: string;
  clearApiKey: boolean;
  baseUrl: string;
  modelName: string;
}

export interface GeneralSettingsPanelRef {
  getValues: () => GeneralPanelValues;
}

interface Props {
  isOpen: boolean;
}

const GeneralSettingsPanel = forwardRef<GeneralSettingsPanelRef, Props>(
  function GeneralSettingsPanel({ isOpen }, ref) {
    const { t } = useTranslation("settings");
    const store = useSettingsStore();

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
        setTempApiKey("");
        setClearStoredApiKey(false);
        setTempBaseUrl(store.baseUrl || "");
        setTempModelName(store.modelName || "");
        setHealthResult(null);
        setHealthError("");
        fetchModels();
        getNoProxy().then(setNoProxyEnabled).catch((e) => logger.debug("Failed to get proxy setting", e));
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
        setHealthError(e instanceof Error ? e.message : String(e));
      } finally {
        setHealthLoading(false);
      }
    };

    return (
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
      </>
    );
  },
);

export default GeneralSettingsPanel;
