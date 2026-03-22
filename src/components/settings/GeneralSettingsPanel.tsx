import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Locale } from "../../i18n";
import { SUPPORTED_LOCALES } from "../../i18n";

export default function GeneralSettingsPanel() {
  const { t } = useTranslation("settings");
  const store = useSettingsStore();

  return (
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
  );
}
