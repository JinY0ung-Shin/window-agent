import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Bug } from "lucide-react";
import Sidebar from "./Sidebar";
import ChatWindow from "../chat/ChatWindow";
import DebugPanel from "../debug/DebugPanel";
import { useDebugStore } from "../../stores/debugStore";

export default function MainLayout() {
  const isDebugOpen = useDebugStore((s) => s.isOpen);
  const setDebugOpen = useDebugStore((s) => s.setOpen);
  const [chromiumInstalling, setChromiumInstalling] = useState(false);

  useEffect(() => {
    const unlisten1 = listen("browser:chromium-installing", () => setChromiumInstalling(true));
    const unlisten2 = listen("browser:chromium-installed", () => setChromiumInstalling(false));
    return () => {
      unlisten1.then(f => f());
      unlisten2.then(f => f());
    };
  }, []);

  return (
    <div className="app-container">
      <Sidebar />
      <ChatWindow />
      <button
        className="debug-toggle-btn"
        onClick={() => setDebugOpen(!isDebugOpen)}
        title="도구 로그"
      >
        <Bug size={18} />
      </button>
      <DebugPanel />
      {chromiumInstalling && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: 'var(--bg-primary, white)',
            padding: '24px 32px',
            borderRadius: '12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
              Installing Chromium...
            </div>
            <div style={{ fontSize: '13px', opacity: 0.7 }}>
              First-time browser setup. This may take a moment.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
