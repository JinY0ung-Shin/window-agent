import { useState, useEffect } from "react";
import { Network, UserPlus, RefreshCw } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import ContactList from "./ContactList";
import ContactDetail from "./ContactDetail";
import PeerThread from "./PeerThread";
import InviteDialog from "./InviteDialog";

export default function NetworkPanel() {
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const status = useNetworkStore((s) => s.status);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const selectedThreadId = useNetworkStore((s) => s.selectedThreadId);
  const refreshContacts = useNetworkStore((s) => s.refreshContacts);
  const error = useNetworkStore((s) => s.error);

  useEffect(() => {
    if (status === "active") {
      refreshContacts();
    }
  }, [status, refreshContacts]);

  if (status !== "active") {
    return (
      <div className="network-panel">
        <div className="network-panel-header">
          <Network size={20} />
          <h2>에이전트 네트워크</h2>
          <div className="network-panel-actions">
            <button
              className="icon-btn"
              onClick={() => setShowInviteDialog(true)}
              title="초대"
            >
              <UserPlus size={16} />
            </button>
          </div>
        </div>
        <div className="network-panel-empty">
          <Network size={40} strokeWidth={1.5} />
          <p>네트워크가 비활성 상태입니다.</p>
          <p className="text-muted">설정에서 P2P 네트워크를 활성화하세요.</p>
        </div>
        {showInviteDialog && (
          <InviteDialog onClose={() => setShowInviteDialog(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="network-panel">
      <div className="network-panel-header">
        <Network size={20} />
        <h2>에이전트 네트워크</h2>
        <div className="network-panel-actions">
          <button
            className="icon-btn"
            onClick={refreshContacts}
            title="새로고침"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowInviteDialog(true)}
            title="초대"
          >
            <UserPlus size={16} />
          </button>
        </div>
      </div>

      {error && <div className="network-error">{error}</div>}

      <div className="network-panel-body">
        {selectedThreadId ? (
          <PeerThread />
        ) : (
          <>
            <ContactList />
            {selectedContactId && <ContactDetail />}
          </>
        )}
      </div>

      {showInviteDialog && (
        <InviteDialog onClose={() => setShowInviteDialog(false)} />
      )}
    </div>
  );
}
