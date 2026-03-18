import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";

export default function WindowControls() {
  const { t } = useTranslation("chat");
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return (
    <div className="window-controls">
      <button
        className="window-control-btn"
        onClick={() => appWindow.minimize()}
        title={t("layout.minimize")}
      >
        <Minus size={14} />
      </button>
      <button
        className="window-control-btn"
        onClick={handleMaximize}
        title={isMaximized ? t("layout.restore") : t("layout.maximize")}
      >
        {isMaximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        className="window-control-btn window-control-close"
        onClick={() => appWindow.close()}
        title={t("layout.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
