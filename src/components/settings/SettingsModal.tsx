import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNavigationStore } from "../../stores/navigationStore";
import GeneralSettingsPanel from "./GeneralSettingsPanel";
import ThinkingSettingsPanel from "./ThinkingSettingsPanel";
import BrandingSettingsPanel from "./BrandingSettingsPanel";
import ApiServerSection from "./ApiServerSection";
import ProxySection from "./ProxySection";
import ExportSection from "./ExportSection";
import CredentialManager from "./CredentialManager";
import type { ApiServerSectionRef } from "./ApiServerSection";
import type { ThinkingSettingsPanelRef } from "./ThinkingSettingsPanel";
import type { BrandingSettingsPanelRef } from "./BrandingSettingsPanel";

type Tab = "api" | "thinking" | "tools" | "appearance" | "credentials" | "backup";

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const store = useSettingsStore();
  const { saveSettings, settingsError } = store;
  const mainView = useNavigationStore((s) => s.mainView);
  const goBack = useNavigationStore((s) => s.goBack);
  const isOpen = mainView === "settings";

  const [tab, setTab] = useState<Tab>("api");

  const apiRef = useRef<ApiServerSectionRef>(null);
  const thinkingRef = useRef<ThinkingSettingsPanelRef>(null);
  const brandingRef = useRef<BrandingSettingsPanelRef>(null);

  useEffect(() => {
    if (isOpen) {
      const defaultTab = store.hasApiKey ? "appearance" : "api";
      setTab(defaultTab);
      if (settingsError) {
        useSettingsStore.setState({ settingsError: null });
      }
    }
  }, [isOpen]);

  const handleSave = () => {
    const branding = brandingRef.current?.getValues();
    const apiValues = apiRef.current?.getValues();
    const thinking = thinkingRef.current?.getValues();
    saveSettings({
      apiKey: apiValues?.apiKey ?? "",
      clearApiKey: apiValues?.clearApiKey ?? false,
      baseUrl: apiValues?.baseUrl ?? "",
      modelName: apiValues?.modelName ?? "",
      thinkingEnabled: thinking?.thinkingEnabled ?? true,
      thinkingBudget: thinking?.thinkingBudget ?? 4096,
      companyName: branding?.companyName.trim(),
      uiTheme: branding?.uiTheme,
    });
  };

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <Settings size={20} color="#6366f1" />
        <h2>{t("title")}</h2>
      </div>

      <div className="settings-tabs" role="tablist">
        {(["api", "thinking", "tools", "appearance", "credentials", "backup"] as const).map((key) => (
          <button
            key={key}
            role="tab"
            id={`settings-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`settings-tabpanel-${key}`}
            className={`settings-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="settings-page-body">
        <div className="settings-page-content" role="tabpanel" id={`settings-tabpanel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
          <div style={{ display: tab === "api" ? undefined : "none" }}>
            <ApiServerSection ref={apiRef} isOpen={isOpen} />
          </div>
          <div style={{ display: tab === "tools" ? undefined : "none" }}>
            <ProxySection isOpen={isOpen} />
          </div>
          <div style={{ display: tab === "thinking" ? undefined : "none" }}>
            <ThinkingSettingsPanel ref={thinkingRef} isOpen={isOpen} />
          </div>
          <div style={{ display: tab === "appearance" ? undefined : "none" }}>
            <GeneralSettingsPanel />
            <BrandingSettingsPanel ref={brandingRef} isOpen={isOpen} />
          </div>
          {tab === "credentials" && <CredentialManager />}
          {tab === "backup" && <ExportSection />}
        </div>
      </div>

      {settingsError && (
        <div className="settings-page-error">{settingsError}</div>
      )}

      <div className="settings-page-footer">
        <button className="btn-secondary" onClick={goBack}>
          {t("common:cancel")}
        </button>
        <button className="btn-primary" onClick={handleSave}>
          {t("common:save")}
        </button>
      </div>
    </div>
  );
}
