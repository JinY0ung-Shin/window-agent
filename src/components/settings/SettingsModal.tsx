import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Settings, X, Wifi } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import GeneralSettingsPanel from "./GeneralSettingsPanel";
import ThinkingSettingsPanel from "./ThinkingSettingsPanel";
import BrandingSettingsPanel from "./BrandingSettingsPanel";
import NetworkSettingsPanel from "./NetworkSettingsPanel";
import ExportSection from "./ExportSection";
import CredentialManager from "./CredentialManager";
import type { GeneralSettingsPanelRef } from "./GeneralSettingsPanel";
import type { ThinkingSettingsPanelRef } from "./ThinkingSettingsPanel";
import type { BrandingSettingsPanelRef } from "./BrandingSettingsPanel";

type Tab = "general" | "thinking" | "branding" | "credentials" | "backup" | "network";

export default function SettingsModal() {
  const { t } = useTranslation("settings");
  const store = useSettingsStore();
  const { isSettingsOpen, setIsSettingsOpen, saveSettings, settingsError } = store;

  const [tab, setTab] = useState<Tab>("general");

  const generalRef = useRef<GeneralSettingsPanelRef>(null);
  const thinkingRef = useRef<ThinkingSettingsPanelRef>(null);
  const brandingRef = useRef<BrandingSettingsPanelRef>(null);

  useEffect(() => {
    if (isSettingsOpen) {
      setTab("general");
    }
  }, [isSettingsOpen]);

  if (!isSettingsOpen) return null;

  const handleSave = () => {
    const branding = brandingRef.current?.getValues();
    if (branding) {
      store.setCompanyName(branding.companyName.trim());
      store.setUITheme(branding.uiTheme);
    }

    const general = generalRef.current?.getValues();
    const thinking = thinkingRef.current?.getValues();
    saveSettings({
      apiKey: general?.apiKey ?? "",
      clearApiKey: general?.clearApiKey ?? false,
      baseUrl: general?.baseUrl ?? "",
      modelName: general?.modelName ?? "",
      thinkingEnabled: thinking?.thinkingEnabled ?? true,
      thinkingBudget: thinking?.thinkingBudget ?? 4096,
    });
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
          {(["general", "thinking", "branding", "credentials", "backup"] as const).map((key) => (
            <button
              key={key}
              className={`settings-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
          <button
            className={`settings-tab ${tab === "network" ? "active" : ""}`}
            onClick={() => setTab("network")}
          >
            <Wifi size={14} />
            {t("tabs.network")}
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: tab === "general" ? undefined : "none" }}>
            <GeneralSettingsPanel ref={generalRef} isOpen={isSettingsOpen} />
          </div>
          <div style={{ display: tab === "thinking" ? undefined : "none" }}>
            <ThinkingSettingsPanel ref={thinkingRef} isOpen={isSettingsOpen} />
          </div>
          <div style={{ display: tab === "branding" ? undefined : "none" }}>
            <BrandingSettingsPanel ref={brandingRef} isOpen={isSettingsOpen} />
          </div>
          {tab === "credentials" && <CredentialManager />}
          {tab === "backup" && <ExportSection />}
          {tab === "network" && <NetworkSettingsPanel isOpen={isSettingsOpen} />}
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
