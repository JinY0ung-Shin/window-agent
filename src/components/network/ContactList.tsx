import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import type { ContactRow } from "../../services/commands/p2pCommands";

function statusDot(status: string) {
  if (status === "connected") return "status-dot online";
  if (status === "connecting") return "status-dot connecting";
  return "status-dot offline";
}

export default function ContactList() {
  const { t } = useTranslation("network");
  const contacts = useNetworkStore((s) => s.contacts);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const selectContact = useNetworkStore((s) => s.selectContact);
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);

  if (contacts.length === 0) {
    return (
      <div className="contact-list-empty">
        <Users size={32} strokeWidth={1.5} />
        <p>{t("contact.noContacts")}</p>
        <p className="text-muted">{t("contact.noContactsHint")}</p>
      </div>
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
          <button
            key={contact.id}
            className={`contact-item${selectedContactId === contact.id ? " active" : ""}`}
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
            <span className="contact-item-mode">{contact.mode === "secretary" ? t("contact.modeSecretary") : contact.mode}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
