import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Bug } from "lucide-react";
import Sidebar from "./Sidebar";
import ChatWindow from "../chat/ChatWindow";
import DebugPanel from "../debug/DebugPanel";
import NetworkPanel from "../network/NetworkPanel";

import { useDebugStore } from "../../stores/debugStore";
import { useMemoryStore } from "../../stores/memoryStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useNetworkStore } from "../../stores/networkStore";

export default function MainLayout() {
  const isDebugOpen = useDebugStore((s) => s.isOpen);
  const setDebugOpen = useDebugStore((s) => s.setOpen);
  const networkViewActive = useNetworkStore((s) => s.networkViewActive);

  const initializeNetwork = useNetworkStore((s) => s.initialize);
  const setupEventListeners = useNetworkStore((s) => s.setupEventListeners);
  const [chromiumInstalling, setChromiumInstalling] = useState(false);

  const [chromiumError, setChromiumError] = useState<string | null>(null);

  // Initialize P2P network store and event listeners
  useEffect(() => {
    initializeNetwork();
    let cleanup: (() => void) | undefined;
    setupEventListeners().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for vault file changes (external Obsidian edits) and refresh stores
  useEffect(() => {
    const refreshStores = () => {
      const agentId = useMemoryStore.getState().currentAgentId;
      if (agentId) {
        useMemoryStore.getState().loadNotes(agentId);
        useVaultStore.getState().loadNotes(agentId);
      }
    };
    const u1 = listen("vault:note-changed", refreshStores);
    const u2 = listen("vault:note-removed", refreshStores);
    const u3 = listen("vault:note-moved", refreshStores);
    return () => {
      u1.then(f => f());
      u2.then(f => f());
      u3.then(f => f());
    };
  }, []);

  useEffect(() => {
    const unlisten1 = listen("browser:chromium-installing", () => {
      setChromiumInstalling(true);
      setChromiumError(null);
    });
    const unlisten2 = listen("browser:chromium-installed", () => setChromiumInstalling(false));
    const unlisten3 = listen<string>("browser:chromium-install-failed", (event) => {
      setChromiumInstalling(false);
      setChromiumError(event.payload || "Installation failed");
    });
    return () => {
      unlisten1.then(f => f());
      unlisten2.then(f => f());
      unlisten3.then(f => f());
    };
  }, []);

  return (
    <div className="app-container">
      <Sidebar />
      {networkViewActive ? (
        <NetworkPanel />
      ) : (
        <ChatWindow />
      )}
      <button
        className="debug-toggle-btn"
        onClick={() => setDebugOpen(!isDebugOpen)}
        title="도구 로그"
      >
        <Bug size={18} />
      </button>
      <DebugPanel />
      {(chromiumInstalling || chromiumError) && (
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
            maxWidth: '400px',
          }}>
            {chromiumError ? (
              <>
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-error, #e53e3e)' }}>
                  Chromium 설치 실패
                </div>
                <div style={{ fontSize: '13px', opacity: 0.7, marginBottom: '12px' }}>
                  {chromiumError}
                </div>
                <button
                  onClick={() => setChromiumError(null)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-primary, #ccc)',
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  닫기
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                  Installing Chromium...
                </div>
                <div style={{ fontSize: '13px', opacity: 0.7 }}>
                  First-time browser setup. This may take a moment.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
