import { Users } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import type { ContactRow } from "../../services/commands/p2pCommands";

function statusDot(status: string) {
  if (status === "connected") return "status-dot online";
  if (status === "connecting") return "status-dot connecting";
  return "status-dot offline";
}

function statusLabel(status: string) {
  if (status === "connected") return "온라인";
  if (status === "connecting") return "연결 중";
  return "오프라인";
}

export default function ContactList() {
  const contacts = useNetworkStore((s) => s.contacts);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const selectContact = useNetworkStore((s) => s.selectContact);
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);

  if (contacts.length === 0) {
    return (
      <div className="contact-list-empty">
        <Users size={32} strokeWidth={1.5} />
        <p>연락처가 없습니다</p>
        <p className="text-muted">초대 코드를 생성하거나 받아서 연결하세요.</p>
      </div>
    );
  }

  return (
    <div className="contact-list">
      <div className="contact-list-header">
        <span>연락처</span>
        <span className="contact-count">{contacts.length}</span>
      </div>
      {contacts.map((contact: ContactRow) => (
        <button
          key={contact.id}
          className={`contact-item${selectedContactId === contact.id ? " active" : ""}`}
          onClick={() =>
            selectContact(selectedContactId === contact.id ? null : contact.id)
          }
        >
          <span className={statusDot(connectedPeers.has(contact.peer_id) ? "connected" : contact.status)} title={statusLabel(connectedPeers.has(contact.peer_id) ? "connected" : contact.status)} />
          <div className="contact-item-info">
            <span className="contact-item-name">
              {contact.display_name || contact.agent_name}
            </span>
            {contact.agent_description && (
              <span className="contact-item-desc">{contact.agent_description}</span>
            )}
          </div>
          <span className="contact-item-mode">{contact.mode === "secretary" ? "비서" : contact.mode}</span>
        </button>
      ))}
    </div>
  );
}
