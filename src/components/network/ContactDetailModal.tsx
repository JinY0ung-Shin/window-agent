import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Save } from "lucide-react";
import type { PublishedAgent } from "../../services/types";
import { useNetworkStore } from "../../stores/networkStore";
import {
  relayUpdateContact,
  relayRemoveContact,
} from "../../services/commands/relayCommands";
import Modal from "../common/Modal";

interface Props {
  contactId: string;
  onClose: () => void;
}

export default function ContactDetailModal({ contactId, onClose }: Props) {
  const { t } = useTranslation("network");
  const contacts = useNetworkStore((s) => s.contacts);
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);
  const approveContact = useNetworkStore((s) => s.approveContact);
  const rejectContact = useNetworkStore((s) => s.rejectContact);
  const selectContact = useNetworkStore((s) => s.selectContact);
  const refreshContacts = useNetworkStore((s) => s.refreshContacts);

  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return null;

  return (
    <ContactDetailInner
      key={contact.id}
      contact={contact}
      isOnline={connectedPeers.has(contact.peer_id)}
      t={t}
      onClose={onClose}
      onDeselect={() => selectContact(null)}
      onRefresh={refreshContacts}
      approveContact={approveContact}
      rejectContact={rejectContact}
    />
  );
}

interface InnerProps {
  contact: {
    id: string;
    peer_id: string;
    display_name: string;
    agent_name: string;
    agent_description: string;
    local_agent_id: string | null;
    published_agents_json: string | null;
    mode: string;
    status: string;
  };
  isOnline: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onDeselect: () => void;
  onRefresh: () => Promise<void>;
  approveContact: (contactId: string) => Promise<void>;
  rejectContact: (contactId: string) => Promise<void>;
}

function ContactDetailInner({ contact, isOnline, t, onClose, onDeselect, onRefresh, approveContact, rejectContact }: InnerProps) {
  const isPendingApproval = contact.status === "pending_approval";
  const [displayName, setDisplayName] = useState(contact.display_name);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const publishedAgents: PublishedAgent[] = useMemo(() => {
    if (!contact.published_agents_json) return [];
    try { return JSON.parse(contact.published_agents_json); } catch { return []; }
  }, [contact.published_agents_json]);

  const statusText = isPendingApproval
    ? t("contact.pendingApproval")
    : isOnline
      ? t("contact.online")
      : t("contact.offline");

  const hasChanges = displayName !== contact.display_name;

  const handleSave = async () => {
    setSaving(true);
    try {
      await relayUpdateContact(
        contact.id,
        displayName !== contact.display_name ? displayName : undefined,
      );
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await relayRemoveContact(contact.id);
    onDeselect();
    await onRefresh();
    onClose();
  };

  const footer = (
    <div className="contact-detail-actions">
      {isPendingApproval && (
        <>
          <button
            className="btn-primary"
            onClick={async () => { await approveContact(contact.id); onClose(); }}
          >
            {t("contact.approveContact")}
          </button>
          <button
            className="btn-danger"
            onClick={async () => { await rejectContact(contact.id); onDeselect(); onClose(); }}
          >
            {t("contact.rejectContact")}
          </button>
        </>
      )}
      {!isPendingApproval && hasChanges && (
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={14} />
          {saving ? t("common:saving") : t("common:save")}
        </button>
      )}
      {!isPendingApproval && (
        !confirmDelete ? (
          <button
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} />
            {t("contact.deleteContact")}
          </button>
        ) : (
          <div className="confirm-delete-row">
            <span>{t("contact.confirmDeleteMessage")}</span>
            <button className="btn-danger" onClick={handleDelete}>{t("common:delete")}</button>
            <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>{t("common:cancel")}</button>
          </div>
        )
      )}
    </div>
  );

  return (
    <Modal
      title={t("contact.detailTitle")}
      onClose={onClose}
      overlayClose="currentTarget"
      contentClassName="contact-detail-modal"
      footer={footer}
    >
      <div className="contact-detail">
        <div className="contact-detail-status-row">
          <span className={`status-badge ${isOnline ? "connected" : contact.status}`}>{statusText}</span>
        </div>

        <div className="form-group">
          <label>{t("contact.displayNameLabel")}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>{t("contact.agentNameLabel")}</label>
          <input type="text" value={contact.agent_name} readOnly disabled />
        </div>

        {contact.agent_description && (
          <div className="form-group">
            <label>{t("contact.descriptionLabel")}</label>
            <input type="text" value={contact.agent_description} readOnly disabled />
          </div>
        )}

        {publishedAgents.length > 0 && (
          <div className="form-group">
            <label>{t("contact.publishedAgents")}</label>
            <div className="published-agents-grid">
              {publishedAgents.map((a) => (
                <div key={a.agent_id} className="published-agent-card">
                  <span className="published-agent-name">{a.name}</span>
                  {a.description && <span className="published-agent-desc">{a.description}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <label>{t("contact.modeLabel")}</label>
          <input type="text" value={t("contact.secretaryMode")} readOnly disabled />
          <span className="form-text">{t("contact.delegateHint")}</span>
        </div>
      </div>
    </Modal>
  );
}
