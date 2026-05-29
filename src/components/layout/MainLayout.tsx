import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Bug, Loader2 } from "lucide-react";
import Sidebar from "./Sidebar";
import ChatWindow from "../chat/ChatWindow";
import DebugPanel from "../debug/DebugPanel";
import SettingsPage from "../settings/SettingsModal";
import NetworkPanel from "../network/NetworkPanel";
import VaultPanel from "../vault/VaultPanel";
import TeamPanel from "../team/TeamPanel";
import TeamChatWindow from "../team/TeamChatWindow";
import CronPanel from "../cron/CronPanel";
import AgentPanel from "../agent/AgentPanel";
import HubPanel from "../hub/HubPanel";
import HubShareDialog from "../hub/HubShareDialog";
import TourOverlay from "../tour/TourOverlay";
import ErrorBoundary from "../common/ErrorBoundary";
import Modal from "../common/Modal";

import { useDebugStore } from "../../stores/debugStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useNetworkStore } from "../../stores/networkStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useTeamStore } from "../../stores/teamStore";
import WindowControls from "./WindowControls";

export default function MainLayout() {
  const { t } = useTranslation("chat");
  const { t: tc } = useTranslation("common");
  const isDebugOpen = useDebugStore((s) => s.isOpen);
  const setDebugOpen = useDebugStore((s) => s.setOpen);
  const mainView = useNavigationStore((s) => s.mainView);
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const initializeNetwork = useNetworkStore((s) => s.initialize);
  const setupEventListeners = useNetworkStore((s) => s.setupEventListeners);
  const [chromiumInstalling, setChromiumInstalling] = useState(false);

  const [chromiumError, setChromiumError] = useState<string | null>(null);

  // Initialize relay network store and event listeners
  useEffect(() => {
    initializeNetwork();
    let cleanup: (() => void) | undefined;
    setupEventListeners().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for vault file changes (external Obsidian edits) and refresh vault store
  useEffect(() => {
    const refreshStores = () => {
      const agentId = useVaultStore.getState().activeAgent;
      if (agentId) {
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
      <WindowControls />
      {mainView === "settings" ? (
        <SettingsPage />
      ) : mainView === "team" ? (
        selectedTeamId ? (
          <ErrorBoundary fallbackClassName="main-area">
            <TeamChatWindow />
          </ErrorBoundary>
        ) : (
          <TeamPanel />
        )
      ) : mainView === "cron" ? (
        <CronPanel />
      ) : mainView === "vault" ? (
        <VaultPanel />
      ) : mainView === "network" ? (
        <NetworkPanel />
      ) : mainView === "agent" ? (
        <AgentPanel />
      ) : mainView === "hub" ? (
        <ErrorBoundary fallbackClassName="main-area">
          <HubPanel />
        </ErrorBoundary>
      ) : (
        <ChatWindow />
      )}
      <button
        className="debug-toggle-btn"
        onClick={() => setDebugOpen(!isDebugOpen)}
        title={t("layout.toolLog")}
        aria-label={t("layout.toolLog")}
      >
        <Bug size={18} />
      </button>
      <DebugPanel />
      <HubShareDialog />
      <TourOverlay />
      {chromiumError ? (
        <Modal
          title={t("layout.chromiumFailed")}
          onClose={() => setChromiumError(null)}
          error={chromiumError}
          footer={
            <button className="btn-secondary" onClick={() => setChromiumError(null)}>
              {tc("close")}
            </button>
          }
        >
          {null}
        </Modal>
      ) : chromiumInstalling ? (
        <div className="modal-overlay">
          <div className="chromium-installing">
            <Loader2 size={28} className="spinning" />
            <div className="chromium-installing-title">{t("layout.chromiumInstalling")}</div>
            <div className="chromium-installing-desc">{t("layout.chromiumInstallingDesc")}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
