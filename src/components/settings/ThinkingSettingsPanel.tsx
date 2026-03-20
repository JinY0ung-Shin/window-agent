import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { DEFAULT_THINKING_BUDGET } from "../../constants";

export interface ThinkingPanelValues {
  thinkingEnabled: boolean;
  thinkingBudget: number;
}

export interface ThinkingSettingsPanelRef {
  getValues: () => ThinkingPanelValues;
}

interface Props {
  isOpen: boolean;
}

const ThinkingSettingsPanel = forwardRef<ThinkingSettingsPanelRef, Props>(
  function ThinkingSettingsPanel({ isOpen }, ref) {
    const { t } = useTranslation("settings");
    const store = useSettingsStore();

    const [tempThinkingEnabled, setTempThinkingEnabled] = useState(true);
    const [tempThinkingBudget, setTempThinkingBudget] = useState(DEFAULT_THINKING_BUDGET);

    useEffect(() => {
      if (isOpen) {
        setTempThinkingEnabled(store.thinkingEnabled ?? true);
        setTempThinkingBudget(store.thinkingBudget || DEFAULT_THINKING_BUDGET);
      }
    }, [isOpen]);

    useImperativeHandle(ref, () => ({
      getValues: () => ({
        thinkingEnabled: tempThinkingEnabled,
        thinkingBudget: tempThinkingBudget,
      }),
    }));

    return (
      <>
        <div className="form-group">
          <div className="toggle-row">
            <label htmlFor="thinkingEnabled">{t("thinking.enableLabel")}</label>
            <button
              id="thinkingEnabled"
              className={`toggle-switch ${tempThinkingEnabled ? "on" : ""}`}
              onClick={() => setTempThinkingEnabled(!tempThinkingEnabled)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <p className="form-text">
            {t("thinking.enableHint")}
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="thinkingBudget">{t("thinking.budgetLabel")}</label>
          <input
            id="thinkingBudget"
            type="number"
            min={256}
            max={32768}
            step={256}
            value={tempThinkingBudget}
            onChange={(e) => setTempThinkingBudget(Number(e.target.value))}
            disabled={!tempThinkingEnabled}
          />
          <input
            type="range"
            min={256}
            max={32768}
            step={256}
            value={tempThinkingBudget}
            onChange={(e) => setTempThinkingBudget(Number(e.target.value))}
            disabled={!tempThinkingEnabled}
            className="budget-slider"
          />
          <p className="form-text">
            {t("thinking.budgetHint")}
          </p>
        </div>
      </>
    );
  },
);

export default ThinkingSettingsPanel;
