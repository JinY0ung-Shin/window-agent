import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Save, RefreshCw } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";
import {
  p2pUpdateContact,
  p2pRemoveContact,
  p2pDialPeer,
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
    addresses_json: string | null;
  };
  agents: { id: string; name: string }[];
  t: (key: string) => string;
  onDeselect: () => void;
  onRefresh: () => Promise<void>;
}

type DialState = "idle" | "dialing" | "connected" | "timeout";

function ContactDetailInner({ contact, agents, t, onDeselect, onRefresh }: InnerProps) {
  const [displayName, setDisplayName] = useState(contact.display_name);
  const [localAgentId, setLocalAgentId] = useState(contact.local_agent_id ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dialState, setDialState] = useState<DialState>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasAddresses = (() => {
    if (!contact.addresses_json) return false;
    try {
      const parsed = JSON.parse(contact.addresses_json);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();

  // Listen for peer-connected event to detect successful connection
  useEffect(() => {
    if (dialState !== "dialing") return;

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<{ peer_id: string }>("p2p:peer-connected", (event) => {
      if (event.payload.peer_id === contact.peer_id && !cancelled) {
        setDialState("connected");
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [dialState, contact.peer_id]);

  // Reset dial state when it transitions to connected/timeout
  useEffect(() => {
    if (dialState === "connected" || dialState === "timeout") {
      const timer = setTimeout(() => setDialState("idle"), 5000);
      return () => clearTimeout(timer);
    }
  }, [dialState]);

  const statusText =
    contact.status === "connected"
      ? t("contact.online")
      : contact.status === "connecting"
        ? t("contact.connecting")
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

  const handleDial = async () => {
    setDialState("dialing");
    try {
      await p2pDialPeer(contact.id);
    } catch {
      setDialState("idle");
      return;
    }
    // Start 10-second timeout
    timeoutRef.current = setTimeout(() => {
      setDialState((prev) => (prev === "dialing" ? "timeout" : prev));
    }, 10000);
  };

  const dialButtonLabel = (() => {
    switch (dialState) {
      case "dialing": return t("contact.dialing");
      case "connected": return t("contact.connected");
      case "timeout": return t("contact.timeout");
      default: return t("contact.reconnect");
    }
  })();

  return (
    <div className="contact-detail">
      <div className="contact-detail-header">
        <h3>{t("contact.detailTitle")}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={`status-badge ${contact.status}`}>{statusText}</span>
          {contact.status !== "connected" && (
            <button
              className="btn-secondary"
              onClick={handleDial}
              disabled={!hasAddresses || dialState === "dialing"}
              title={!hasAddresses ? t("contact.noAddressHint") : t("contact.reconnectTitle")}
              style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "2px 8px" }}
            >
              <RefreshCw size={12} className={dialState === "dialing" ? "spinning" : ""} />
              {dialButtonLabel}
            </button>
          )}
        </div>
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
        {hasChanges && (
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? t("common:saving") : t("common:save")}
          </button>
        )}
        {!confirmDelete ? (
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
        )}
      </div>
    </div>
  );
}
