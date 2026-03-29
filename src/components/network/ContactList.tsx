import { useTranslation } from "react-i18next";
import { Users, Settings } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import type { ContactRow } from "../../services/commands/relayCommands";
import EmptyState from "../common/EmptyState";

function statusDot(status: string) {
  if (status === "connected") return "status-dot online";
  if (status === "connecting") return "status-dot connecting";
  return "status-dot offline";
}

interface ContactListProps {
  onOpenDetail: (contactId: string) => void;
}

export default function ContactList({ onOpenDetail }: ContactListProps) {
  const { t } = useTranslation("network");
  const contacts = useNetworkStore((s) => s.contacts);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const selectContact = useNetworkStore((s) => s.selectContact);
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={<Users size={32} strokeWidth={1.5} />}
        message={t("contact.noContacts")}
        hint={t("contact.noContactsHint")}
        className="contact-list-empty"
      />
    );
  }

  return (
    <div className="contact-list">
      <div className="contact-list-header">
        <span>{t("contact.listHeader")}</span>
        <span className="contact-count">{contacts.length}</span>
      </div>
      <div className="contact-list-items">
        {contacts.map((contact: ContactRow) => (
          <div
            key={contact.id}
            className={`contact-item${selectedContactId === contact.id ? " active" : ""}`}
          >
            <button
              className="contact-item-main"
              onClick={() =>
                selectContact(selectedContactId === contact.id ? null : contact.id)
              }
            >
              <span className={statusDot(connectedPeers.has(contact.peer_id) ? "connected" : contact.status)} title={t(`contact.${connectedPeers.has(contact.peer_id) ? "online" : contact.status === "connecting" ? "connecting" : "offline"}`)} />
              <div className="contact-item-info">
                <span className="contact-item-name">
                  {contact.display_name || contact.agent_name}
                </span>
                {contact.agent_description && (
                  <span className="contact-item-desc">{contact.agent_description}</span>
                )}
              </div>
              {contact.status === "pending_outgoing" ? (
                <span className="contact-item-badge pending-outgoing">{t("directory.pendingOutgoing")}</span>
              ) : contact.status === "pending_approval" ? (
                <span className="contact-item-badge pending-approval">{t("contact.pendingApproval")}</span>
              ) : (
                <span className="contact-item-mode">{contact.mode === "secretary" ? t("contact.modeSecretary") : contact.mode}</span>
              )}
            </button>
            <button
              className="contact-item-settings"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(contact.id);
              }}
              title={t("contact.detailTitle")}
            >
              <Settings size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
