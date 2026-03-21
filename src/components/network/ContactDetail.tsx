import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Save } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";
import {
  p2pUpdateContact,
  p2pRemoveContact,
} from "../../services/commands/p2pCommands";

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
    mode: string;
    status: string;
  };
  agents: { id: string; name: string }[];
  t: (key: string) => string;
  onDeselect: () => void;
  onRefresh: () => Promise<void>;
}

function ContactDetailInner({ contact, agents, t, onDeselect, onRefresh }: InnerProps) {
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);
  const approveContact = useNetworkStore((s) => s.approveContact);
  const rejectContact = useNetworkStore((s) => s.rejectContact);
  const isOnline = connectedPeers.has(contact.peer_id);
  const isPendingApproval = contact.status === "pending_approval";
  const [displayName, setDisplayName] = useState(contact.display_name);
  const [localAgentId, setLocalAgentId] = useState(contact.local_agent_id ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const statusText = isPendingApproval
    ? t("contact.pendingApproval")
    : isOnline
      ? t("contact.online")
      : t("contact.offline");

  const hasChanges =
    displayName !== contact.display_name ||
    (localAgentId || null) !== contact.local_agent_id;

  const handleSave = async () => {
    setSaving(true);
    try {
      await p2pUpdateContact(
        contact.id,
        displayName !== contact.display_name ? displayName : undefined,
        localAgentId !== (contact.local_agent_id ?? "") ? localAgentId || undefined : undefined,
      );
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await p2pRemoveContact(contact.id);
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

      <div className="form-group">
        <label>{t("contact.boundAgentLabel")}</label>
        <select
          value={localAgentId}
          onChange={(e) => setLocalAgentId(e.target.value)}
        >
          <option value="">{t("invite.noSelection")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <span className="form-text">{t("contact.boundAgentHint")}</span>
      </div>

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
