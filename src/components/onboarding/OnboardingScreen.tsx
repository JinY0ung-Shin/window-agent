import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Bot, Globe, Loader, Sparkles } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import { seedManagerAfterOnboarding } from "../../services/initService";
import type { UITheme } from "../../stores/settingsStore";
import type { Locale } from "../../i18n";
import { logger } from "../../services/logger";

type OnboardingStep = "language" | "setup";

export default function OnboardingScreen() {
  const { t } = useTranslation("onboarding");
  const setLocale = useSettingsStore((s) => s.setLocale);
  const initializeBranding = useSettingsStore((s) => s.initializeBranding);
  const locale = useSettingsStore((s) => s.locale);
  const [step, setStep] = useState<OnboardingStep>("language");
  const [selectedLocale, setSelectedLocale] = useState<Locale>(locale);
  const [companyName, setCompanyName] = useState("");
  const [selectedTheme, setSelectedTheme] = useState<UITheme>("org");
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState(false);
  const { compositionProps } = useCompositionInput(setCompanyName);

  const handleLocaleSelect = (loc: Locale) => {
    setSelectedLocale(loc);
    setLocale(loc); // Switch immediately so the rest of onboarding renders in the chosen language
  };

  const handleNext = () => {
    setStep("setup");
  };

  const handleStart = async () => {
    setSeeding(true);
    setSeedError(false);
    try {
      await seedManagerAfterOnboarding(selectedLocale);
      initializeBranding(companyName.trim(), selectedTheme, selectedLocale);
    } catch (e) {
      logger.error("Onboarding seed failed:", e);
      setSeedError(true);
      setSeeding(false);
    }
  };

  if (step === "language") {
    return (
      <div className="onboarding-screen">
        <div className="onboarding-card">
          <div className="onboarding-icon">
            <Globe size={40} />
          </div>
          <h1 className="onboarding-title">{t("languageLabel")}</h1>

          <div className="onboarding-field">
            <div className="onboarding-theme-buttons">
              <button
                className={`onboarding-theme-btn ${selectedLocale === "ko" ? "selected" : ""}`}
                onClick={() => handleLocaleSelect("ko")}
              >
                <span className="theme-btn-title">{t("languageKo")}</span>
                <span className="theme-btn-desc">{t("languageKoDesc")}</span>
              </button>
              <button
                className={`onboarding-theme-btn ${selectedLocale === "en" ? "selected" : ""}`}
                onClick={() => handleLocaleSelect("en")}
              >
                <span className="theme-btn-title">{t("languageEn")}</span>
                <span className="theme-btn-desc">{t("languageEnDesc")}</span>
              </button>
            </div>
          </div>

          <button className="onboarding-start-btn" onClick={handleNext}>
            {t("nextButton")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <div className="onboarding-icon">
          <Sparkles size={40} />
        </div>
        <h1 className="onboarding-title">{t("welcomeTitle")}</h1>
        <p className="onboarding-subtitle">
          {t("welcomeSubtitle")}
        </p>

        <div className="onboarding-field">
          <label htmlFor="companyName">{t("companyNameLabel")}</label>
          <input
            id="companyName"
            type="text"
            placeholder={t("companyNamePlaceholder")}
            value={companyName}
            autoFocus
            {...compositionProps}
          />
        </div>

        <div className="onboarding-field">
          <label>{t("themeLabel")}</label>
          <div className="onboarding-theme-buttons">
            <button
              className={`onboarding-theme-btn ${selectedTheme === "classic" ? "selected" : ""}`}
              onClick={() => setSelectedTheme("classic")}
            >
              <Bot size={24} />
              <span className="theme-btn-title">{t("classicMode")}</span>
              <span className="theme-btn-desc">{t("classicModeDesc")}</span>
            </button>
            <button
              className={`onboarding-theme-btn ${selectedTheme === "org" ? "selected" : ""}`}
              onClick={() => setSelectedTheme("org")}
            >
              <Building2 size={24} />
              <span className="theme-btn-title">{t("orgMode")}</span>
              <span className="theme-btn-desc">{t("orgModeDesc")}</span>
            </button>
          </div>
        </div>

        {seedError && (
          <p className="onboarding-error">{t("seedingError")}</p>
        )}

        <button className="onboarding-start-btn" onClick={handleStart} disabled={!companyName.trim() || seeding}>
          {seeding ? (
            <>
              <Loader size={16} className="spinning" />
              {t("seedingMessage")}
            </>
          ) : (
            t("startButton")
          )}
        </button>
      </div>
    </div>
  );
}
