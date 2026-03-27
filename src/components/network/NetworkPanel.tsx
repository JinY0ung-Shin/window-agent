import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Network, Users, RefreshCw } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import DraggableHeader from "../layout/DraggableHeader";
import EmptyState from "../common/EmptyState";
import ContactList from "./ContactList";
import PeerThread from "./PeerThread";
import InviteDialog from "./InviteDialog";

export default function NetworkPanel() {
  const { t } = useTranslation("network");
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const status = useNetworkStore((s) => s.status);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const refreshContacts = useNetworkStore((s) => s.refreshContacts);
  const error = useNetworkStore((s) => s.error);

  useEffect(() => {
    if (status === "active") {
      refreshContacts();
    }
  }, [status, refreshContacts]);

  // Reset settings view when contact changes
  useEffect(() => {
    setShowSettings(false);
  }, [selectedContactId]);

  if (status !== "active") {
    return (
      <div className="network-panel">
        <DraggableHeader className="network-panel-header">
          <Network size={20} />
          <h2>{t("panel.title")}</h2>
        </DraggableHeader>
        <EmptyState
          icon={<Network size={40} strokeWidth={1.5} />}
          message={t("panel.inactive")}
          hint={t("panel.inactiveHint")}
          className="network-panel-empty"
        />
      </div>
    );
  }

  return (
    <div className="network-panel network-panel--messenger">
      {/* Left sidebar: contacts */}
      <div className="network-panel-sidebar">
        <DraggableHeader className="network-panel-header">
          <Network size={20} />
          <h2>{t("panel.title")}</h2>
          <div className="network-panel-actions">
            <button
              className="icon-btn"
              onClick={refreshContacts}
              title={t("panel.refreshTitle")}
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setShowInviteDialog(true)}
              title={t("directory.title")}
            >
              <Users size={16} />
            </button>
          </div>
        </DraggableHeader>
        {error && <div className="network-error">{error}</div>}
        <ContactList />
      </div>

      {/* Right main area: chat or empty */}
      <div className="network-panel-main">
        {selectedContactId ? (
          <PeerThread
            settingsOpen={showSettings}
            onToggleSettings={() => setShowSettings((open) => !open)}
          />
        ) : (
          <div className="network-panel-empty-chat">
            <Network size={48} strokeWidth={1} />
            <p className="text-muted">{t("peer.selectConversation")}</p>
          </div>
        )}
      </div>

      {showInviteDialog && (
        <InviteDialog onClose={() => setShowInviteDialog(false)} />
      )}
    </div>
  );
}
