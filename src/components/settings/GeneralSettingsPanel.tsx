import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Locale } from "../../i18n";
import { SUPPORTED_LOCALES } from "../../i18n";
import { getShellInfo, type ShellInfo } from "../../services/commands/apiCommands";
import {
  getNotificationsEnabled,
  setNotificationsEnabled,
  requestNotificationPermission,
} from "../../services/notificationService";

export default function GeneralSettingsPanel() {
  const { t } = useTranslation(["settings", "notification"]);
  const store = useSettingsStore();
  const [shellInfo, setShellInfo] = useState<ShellInfo | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(getNotificationsEnabled);
  const [notifDenied, setNotifDenied] = useState(
    () => "Notification" in window && Notification.permission === "denied",
  );

  useEffect(() => {
    getShellInfo().then(setShellInfo).catch(() => {});
  }, []);

  const handleNotifToggle = async () => {
    const next = !notifEnabled;
    setNotifEnabled(next);
    setNotificationsEnabled(next);
    if (next) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setNotifDenied(true);
      }
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
        <label className="toggle-row">
          <span>{t("notification:settings.label")}</span>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={notifEnabled}
            onChange={handleNotifToggle}
          />
        </label>
        <span className="form-hint">{t("notification:settings.hint")}</span>
        {notifDenied && notifEnabled && (
          <span className="form-hint" style={{ color: "var(--color-error)" }}>
            {t("notification:settings.permissionDenied")}
          </span>
        )}
      </div>

      {shellInfo && (
        <div className="form-group">
          <label>{t("shell.label")}</label>
          <div className="shell-info">
            <div className="shell-info-row">
              <span className="shell-info-key">{t("shell.program")}</span>
              <code className="shell-info-value">{shellInfo.program}</code>
            </div>
            <div className="shell-info-row">
              <span className="shell-info-key">{t("shell.type")}</span>
              <span className="shell-info-value">{shellInfo.shell_type}</span>
            </div>
            <div className="shell-info-row">
              <span className="shell-info-key">{t("shell.sshHardening")}</span>
              <span className={`shell-info-badge ${shellInfo.ssh_hardening ? "active" : ""}`}>
                {shellInfo.ssh_hardening ? t("shell.enabled") : t("shell.disabled")}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
