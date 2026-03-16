import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";

export default function WindowControls() {
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
        title="최소화"
      >
        <Minus size={14} />
      </button>
      <button
        className="window-control-btn"
        onClick={handleMaximize}
        title={isMaximized ? "이전 크기로" : "최대화"}
      >
        {isMaximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        className="window-control-btn window-control-close"
        onClick={() => appWindow.close()}
        title="닫기"
      >
        <X size={14} />
      </button>
    </div>
  );
}
