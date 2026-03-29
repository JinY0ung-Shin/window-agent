import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getBrowserProxy, setBrowserProxy, detectSystemProxy,
  getBrowserNoProxy, setBrowserNoProxy, detectSystemNoProxy,
  getBrowserHeadless, setBrowserHeadless,
} from "../../services/commands/apiCommands";
import { logger } from "../../services/logger";

interface Props {
  isOpen: boolean;
}

export default function ProxySection({ isOpen }: Props) {
  const { t } = useTranslation("settings");

  const [browserProxy, setBrowserProxyState] = useState("");
  const [browserNoProxy, setBrowserNoProxyState] = useState("");
  const [browserProxySaving, setBrowserProxySaving] = useState(false);
  const [browserProxySaved, setBrowserProxySaved] = useState(false);
  const [browserProxyDetecting, setBrowserProxyDetecting] = useState(false);
  const [browserProxyDetectMsg, setBrowserProxyDetectMsg] = useState("");
  const [headless, setHeadless] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getBrowserProxy().then((p) => {
        setBrowserProxyState(p);
        setBrowserProxySaved(false);
        setBrowserProxyDetectMsg("");
      }).catch((e) => logger.debug("Failed to get browser proxy", e));
      getBrowserNoProxy().then(setBrowserNoProxyState)
        .catch((e) => logger.debug("Failed to get browser no_proxy", e));
      getBrowserHeadless().then(setHeadless).catch((e) => logger.debug("Failed to get headless", e));
    }
  }, [isOpen]);

  return (
    <>
    <div className="form-group">
      <label className="toggle-label">
        <span>{t("general.browserHeadlessLabel")}</span>
        <input
          type="checkbox"
          checked={headless}
          onChange={async (e) => {
            const val = e.target.checked;
            setHeadless(val);
            try {
              await setBrowserHeadless(val);
            } catch (err) {
              logger.debug("Failed to set headless", err);
              setHeadless(!val);
            }
          }}
        />
      </label>
      <p className="form-text">{t("general.browserHeadlessHint")}</p>
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
              await Promise.all([
                setBrowserProxy(browserProxy.trim()),
                setBrowserNoProxy(browserNoProxy.trim()),
              ]);
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
              const [detectedProxy, detectedNoProxy] = await Promise.all([
                detectSystemProxy(),
                detectSystemNoProxy(),
              ]);
              if (detectedProxy) {
                setBrowserProxyState(detectedProxy);
                if (detectedNoProxy) {
                  setBrowserNoProxyState(detectedNoProxy);
                }
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
      <label htmlFor="browserNoProxy">{t("general.browserNoProxyLabel", { defaultValue: "No Proxy" })}</label>
      <input
        id="browserNoProxy"
        type="text"
        placeholder={t("general.browserNoProxyPlaceholder", { defaultValue: "localhost,127.0.0.1,*.local" })}
        value={browserNoProxy}
        onChange={(e) => {
          setBrowserNoProxyState(e.target.value);
          setBrowserProxySaved(false);
        }}
      />
      <p className="form-text">{t("general.browserNoProxyHint", { defaultValue: "Comma-separated list of hosts to bypass proxy (e.g. localhost,127.0.0.1,*.example.com)" })}</p>
    </div>
    </>
  );
}
