import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Save } from "lucide-react";
import type { PublishedAgent } from "../../services/types";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";
import {
  relayUpdateContact,
  relayRemoveContact,
} from "../../services/commands/relayCommands";

export default function ContactDetail() {
  const { t } = useTranslation("network");
  const contacts = useNetworkStore((s) => s.contacts);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const selectContact = useNetworkStore((s) => s.selectContact);
  const refreshContacts = useNetworkStore((s) => s.refreshContacts);
  const agents = useAgentStore((s) => s.agents);

  const contact = contacts.find((c) => c.id === selectedContactId);
  if (!contact) return null;

  return (
    <ContactDetailInner
      key={contact.id}
      contact={contact}
      agents={agents}
      t={t}
      onDeselect={() => selectContact(null)}
      onRefresh={refreshContacts}
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
  agents: { id: string; name: string }[];
  t: (key: string) => string;
  onDeselect: () => void;
  onRefresh: () => Promise<void>;
}

function ContactDetailInner({ contact, t, onDeselect, onRefresh }: InnerProps) {
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);
  const approveContact = useNetworkStore((s) => s.approveContact);
  const rejectContact = useNetworkStore((s) => s.rejectContact);
  const isOnline = connectedPeers.has(contact.peer_id);
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
  };

  return (
    <div className="contact-detail">
      <div className="contact-detail-header">
        <h3>{t("contact.detailTitle")}</h3>
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
          <ul className="published-agents-list">
            {publishedAgents.map((a) => (
              <li key={a.agent_id}>
                <strong>{a.name}</strong>
                {a.description && <span> — {a.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-group">
        <label>{t("contact.modeLabel")}</label>
        <input type="text" value={t("contact.secretaryMode")} readOnly disabled />
        <span className="form-text">{t("contact.delegateHint")}</span>
      </div>

      <div className="contact-detail-actions">
        {isPendingApproval && (
          <>
            <button
              className="btn-primary"
              onClick={async () => { await approveContact(contact.id); }}
            >
              {t("contact.approveContact")}
            </button>
            <button
              className="btn-danger"
              onClick={async () => { await rejectContact(contact.id); onDeselect(); }}
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
    </div>
  );
}
