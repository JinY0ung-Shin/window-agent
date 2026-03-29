import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNavigationStore } from "../../stores/navigationStore";
import GeneralSettingsPanel from "./GeneralSettingsPanel";
import ThinkingSettingsPanel from "./ThinkingSettingsPanel";
import BrandingSettingsPanel from "./BrandingSettingsPanel";
import NetworkSettingsPanel from "./NetworkSettingsPanel";
import ExportSection from "./ExportSection";
import CredentialManager from "./CredentialManager";
import type { NetworkSettingsPanelRef } from "./NetworkSettingsPanel";
import type { ThinkingSettingsPanelRef } from "./ThinkingSettingsPanel";
import type { BrandingSettingsPanelRef } from "./BrandingSettingsPanel";

type Tab = "general" | "thinking" | "branding" | "credentials" | "backup" | "network";

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const store = useSettingsStore();
  const { saveSettings, settingsError } = store;
  const mainView = useNavigationStore((s) => s.mainView);
  const goBack = useNavigationStore((s) => s.goBack);
  const isOpen = mainView === "settings";

  const [tab, setTab] = useState<Tab>("general");

  const networkRef = useRef<NetworkSettingsPanelRef>(null);
  const thinkingRef = useRef<ThinkingSettingsPanelRef>(null);
  const brandingRef = useRef<BrandingSettingsPanelRef>(null);

  useEffect(() => {
    if (isOpen) {
      // If no API key, start on network tab where API settings live
      const defaultTab = store.hasApiKey ? "general" : "network";
      setTab(defaultTab);
      // Clear stale errors from previous visits
      if (settingsError) {
        useSettingsStore.setState({ settingsError: null });
      }
    }
  }, [isOpen]);

  const handleSave = () => {
    const branding = brandingRef.current?.getValues();
    const networkValues = networkRef.current?.getValues();
    const thinking = thinkingRef.current?.getValues();
    saveSettings({
      apiKey: networkValues?.apiKey ?? "",
      clearApiKey: networkValues?.clearApiKey ?? false,
      baseUrl: networkValues?.baseUrl ?? "",
      modelName: networkValues?.modelName ?? "",
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
        {(["general", "thinking", "branding", "credentials", "backup", "network"] as const).map((key) => (
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
          <div style={{ display: tab === "general" ? undefined : "none" }}>
            <GeneralSettingsPanel />
          </div>
          <div style={{ display: tab === "thinking" ? undefined : "none" }}>
            <ThinkingSettingsPanel ref={thinkingRef} isOpen={isOpen} />
          </div>
          <div style={{ display: tab === "branding" ? undefined : "none" }}>
            <BrandingSettingsPanel ref={brandingRef} isOpen={isOpen} />
          </div>
          {tab === "credentials" && <CredentialManager />}
          {tab === "backup" && <ExportSection />}
          <div style={{ display: tab === "network" ? undefined : "none" }}>
            <NetworkSettingsPanel ref={networkRef} isOpen={isOpen} />
          </div>
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
