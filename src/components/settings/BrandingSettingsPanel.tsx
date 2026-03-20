import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import { useSettingsStore } from "../../stores/settingsStore";
import type { UITheme } from "../../stores/settingsStore";

export interface BrandingPanelValues {
  companyName: string;
  uiTheme: UITheme;
}

export interface BrandingSettingsPanelRef {
  getValues: () => BrandingPanelValues;
}

interface Props {
  isOpen: boolean;
}

const BrandingSettingsPanel = forwardRef<BrandingSettingsPanelRef, Props>(
  function BrandingSettingsPanel({ isOpen }, ref) {
    const { t } = useTranslation("settings");
    const store = useSettingsStore();

    const [tempCompanyName, setTempCompanyName] = useState("");
    const [tempUITheme, setTempUITheme] = useState<UITheme>("org");
    const companyNameComposition = useCompositionInput(setTempCompanyName);

    useEffect(() => {
      if (isOpen) {
        setTempCompanyName(store.companyName || "");
        setTempUITheme(store.uiTheme || "org");
      }
    }, [isOpen]);

    useImperativeHandle(ref, () => ({
      getValues: () => ({
        companyName: tempCompanyName,
        uiTheme: tempUITheme,
      }),
    }));

    return (
      <>
        <div className="form-group">
          <label htmlFor="companyName">{t("branding.companyNameLabel")}</label>
          <input
            id="companyName"
            type="text"
            placeholder={t("branding.companyNamePlaceholder")}
            value={tempCompanyName}
            {...companyNameComposition.compositionProps}
          />
          <p className="form-text">
            {t("branding.companyNameHint")}
          </p>
        </div>

        <div className="form-group">
          <label>{t("branding.themeLabel")}</label>
          <div className="toggle-row">
            <span>{tempUITheme === "org" ? t("branding.themeOrg") : t("branding.themeClassic")}</span>
            <button
              className={`toggle-switch ${tempUITheme === "org" ? "on" : ""}`}
              onClick={() => setTempUITheme(tempUITheme === "org" ? "classic" : "org")}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <p className="form-text">
            {t("branding.themeHint")}
          </p>
        </div>
      </>
    );
  },
);

export default BrandingSettingsPanel;
