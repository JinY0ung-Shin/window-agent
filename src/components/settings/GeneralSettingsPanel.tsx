import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Locale } from "../../i18n";
import { SUPPORTED_LOCALES } from "../../i18n";
import { getShellInfo, type ShellInfo } from "../../services/commands/apiCommands";

export default function GeneralSettingsPanel() {
  const { t } = useTranslation("settings");
  const store = useSettingsStore();
  const [shellInfo, setShellInfo] = useState<ShellInfo | null>(null);

  useEffect(() => {
    getShellInfo().then(setShellInfo).catch(() => {});
  }, []);

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
