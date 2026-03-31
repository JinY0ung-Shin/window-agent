import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getAppSettings, setAppSettings } from "../../services/commands/apiCommands";
import { useSettingsStore } from "../../stores/settingsStore";
import { logger } from "../../services/logger";

interface Props {
  isOpen: boolean;
}

export default function ToolIterationsSection({ isOpen }: Props) {
  const { t } = useTranslation("settings");
  const [value, setValue] = useState(10);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getAppSettings()
        .then((s) => {
          setValue(s.max_tool_iterations);
          setSaved(false);
        })
        .catch((e) => logger.debug("Failed to get max_tool_iterations", e));
    }
  }, [isOpen]);

  const handleChange = async (newVal: number) => {
    const clamped = Math.max(1, Math.min(100, newVal));
    setValue(clamped);
    setSaved(false);
    try {
      await setAppSettings({ max_tool_iterations: clamped });
      useSettingsStore.setState({ maxToolIterations: clamped });
      setSaved(true);
    } catch (e) {
      logger.debug("Failed to save max_tool_iterations", e);
    }
  };

  return (
    <div className="form-group">
      <label htmlFor="maxToolIterations">{t("tools.maxIterationsLabel")}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          id="maxToolIterations"
          type="number"
          min={1}
          max={100}
          value={value}
          onChange={(e) => {
            const num = parseInt(e.target.value, 10);
            if (!isNaN(num)) handleChange(num);
          }}
          style={{ width: 80 }}
        />
        {saved && <span className="form-text text-success" style={{ margin: 0 }}>{t("general.browserProxySaved")}</span>}
      </div>
      <p className="form-text">{t("tools.maxIterationsHint")}</p>
    </div>
  );
}
