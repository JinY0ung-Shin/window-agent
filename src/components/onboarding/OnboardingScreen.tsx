import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Bot, Globe, Key, Loader, Sparkles } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import { seedManagerAfterOnboarding } from "../../services/initService";
import type { UITheme } from "../../stores/settingsStore";
import type { Locale } from "../../i18n";
import { logger } from "../../services/logger";

type OnboardingStep = "language" | "setup" | "api";

const STEP_ORDER: OnboardingStep[] = ["language", "setup", "api"];

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="onboarding-step-indicator">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`step-dot ${i === current ? "active" : ""} ${i < current ? "done" : ""}`}
        />
      ))}
    </div>
  );
}

export default function OnboardingScreen() {
  const { t } = useTranslation("onboarding");
  const setLocale = useSettingsStore((s) => s.setLocale);
  const initializeBranding = useSettingsStore((s) => s.initializeBranding);
  const saveOnboardingApiConfig = useSettingsStore((s) => s.saveOnboardingApiConfig);
  const locale = useSettingsStore((s) => s.locale);
  const [step, setStep] = useState<OnboardingStep>("language");
  const [selectedLocale, setSelectedLocale] = useState<Locale>(locale);
  const [companyName, setCompanyName] = useState("");
  const [selectedTheme, setSelectedTheme] = useState<UITheme>("org");
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState(false);
  const [animState, setAnimState] = useState<"in" | "out">("in");
  // API step state
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiTesting, setApiTesting] = useState(false);
  const [apiError, setApiError] = useState("");
  const { compositionProps } = useCompositionInput(setCompanyName);
  const companyInputRef = useRef<HTMLInputElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const stepIndex = STEP_ORDER.indexOf(step);

  // Restore focus after step transitions
  useEffect(() => {
    if (animState !== "in") return;
    const timer = setTimeout(() => {
      if (step === "setup") {
        companyInputRef.current?.focus();
      } else if (step === "api") {
        apiKeyInputRef.current?.focus();
      } else {
        nextBtnRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [step, animState]);

  const transitionTo = useCallback((nextStep: OnboardingStep) => {
    setAnimState("out");
    setTimeout(() => {
      setStep(nextStep);
      setAnimState("in");
    }, 150);
  }, []);

  const handleLocaleSelect = (loc: Locale) => {
    setSelectedLocale(loc);
    setLocale(loc);
  };

  const handleNext = () => {
    transitionTo("setup");
  };

  const handleBack = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) transitionTo(STEP_ORDER[idx - 1]);
  };

  const handleSetupComplete = async () => {
    setSeeding(true);
    setSeedError(false);
    try {
      await seedManagerAfterOnboarding(selectedLocale);
      // Check if API is already configured (env vars) — auto-skip api step
      await useSettingsStore.getState().waitForEnv();
      const { hasApiKey } = useSettingsStore.getState();
      if (hasApiKey) {
        initializeBranding(companyName.trim(), selectedTheme, selectedLocale);
      } else {
        transitionTo("api");
        setSeeding(false);
      }
    } catch (e) {
      logger.error("Onboarding seed failed:", e);
      setSeedError(true);
      setSeeding(false);
    }
  };

  const handleApiSave = async () => {
    setApiTesting(true);
    setApiError("");
    try {
      await saveOnboardingApiConfig(apiKey, (apiBaseUrl || useSettingsStore.getState().baseUrl).trim());
      initializeBranding(companyName.trim(), selectedTheme, selectedLocale);
    } catch {
      setApiError(t("apiSaveError"));
      setApiTesting(false);
    }
  };

  const handleApiSkip = () => {
    initializeBranding(companyName.trim(), selectedTheme, selectedLocale);
  };

  const renderLanguageStep = () => (
    <>
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

      <button ref={nextBtnRef} className="onboarding-start-btn" onClick={handleNext}>
        {t("nextButton")}
      </button>
    </>
  );

  const renderSetupStep = () => (
    <>
      <div className="onboarding-icon">
        <Sparkles size={40} />
      </div>
      <h1 className="onboarding-title">{t("welcomeTitle")}</h1>
      <p className="onboarding-subtitle">{t("welcomeSubtitle")}</p>

      <div className="onboarding-field">
        <label htmlFor="companyName">{t("companyNameLabel")}</label>
        <div className="onboarding-input-wrapper">
          <input
            ref={companyInputRef}
            id="companyName"
            type="text"
            placeholder={t("companyNamePlaceholder")}
            value={companyName}
            maxLength={50}
            aria-describedby="companyName-count"
            {...compositionProps}
          />
          <span id="companyName-count" className="onboarding-char-count" aria-live="polite">{companyName.length}/50</span>
        </div>
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

      {companyName.trim() && !seeding && (
        <div className="onboarding-summary">
          {t("summaryText", {
            company: companyName.trim(),
            theme: t(selectedTheme === "org" ? "orgMode" : "classicMode"),
          })}
        </div>
      )}

      {seedError && (
        <p className="onboarding-error">{t("seedingError")}</p>
      )}

      <div className="onboarding-btn-row">
        <button className="onboarding-back-btn" onClick={handleBack} disabled={seeding}>
          {t("backButton")}
        </button>
        <button
          className="onboarding-start-btn"
          onClick={handleSetupComplete}
          disabled={!companyName.trim() || seeding}
        >
          {seeding ? (
            <>
              <Loader size={16} className="spinning" />
              {t("seedingMessage")}
            </>
          ) : (
            t("nextButton")
          )}
        </button>
      </div>
    </>
  );

  const renderApiStep = () => (
    <>
      <div className="onboarding-icon">
        <Key size={40} />
      </div>
      <h1 className="onboarding-title">{t("apiTitle")}</h1>
      <p className="onboarding-subtitle">{t("apiSubtitle")}</p>

      <div className="onboarding-field">
        <label htmlFor="apiKey">{t("apiKeyLabel")}</label>
        <input
          ref={apiKeyInputRef}
          id="apiKey"
          type="password"
          placeholder={t("apiKeyPlaceholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <div className="onboarding-field">
        <label htmlFor="apiBaseUrl">{t("apiBaseUrlLabel")}</label>
        <input
          id="apiBaseUrl"
          type="url"
          placeholder={t("apiBaseUrlPlaceholder")}
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
        />
      </div>

      {apiError && (
        <p className="onboarding-error">{apiError}</p>
      )}

      <div className="onboarding-btn-row">
        <button className="onboarding-back-btn" onClick={handleBack} disabled={apiTesting}>
          {t("backButton")}
        </button>
        <button
          className="onboarding-start-btn"
          onClick={handleApiSave}
          disabled={(!apiKey.trim() && !apiBaseUrl.trim()) || apiTesting}
        >
          {apiTesting ? (
            <>
              <Loader size={16} className="spinning" />
              {t("apiSavingMessage")}
            </>
          ) : (
            t("startButton")
          )}
        </button>
      </div>

      <button className="onboarding-skip-btn" onClick={handleApiSkip} disabled={apiTesting}>
        {t("apiSkipButton")}
      </button>
    </>
  );

  const renderStep = () => {
    switch (step) {
      case "language": return renderLanguageStep();
      case "setup": return renderSetupStep();
      case "api": return renderApiStep();
    }
  };

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <StepIndicator current={stepIndex} total={STEP_ORDER.length} />
        <div className={`onboarding-step-body ${animState === "out" ? "fade-out" : "fade-in"}`}>
          {renderStep()}
        </div>
      </div>
    </div>
  );
}
