import { useState, useEffect, useRef } from "react";
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
  onDeselect: () => void;
  onRefresh: () => Promise<void>;
}

type DialState = "idle" | "dialing" | "connected" | "timeout";

function ContactDetailInner({ contact, agents, onDeselect, onRefresh }: InnerProps) {
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
      ? "온라인"
      : contact.status === "connecting"
        ? "연결 중"
        : "오프라인";

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
      case "dialing": return "연결 시도 중...";
      case "connected": return "연결됨";
      case "timeout": return "아직 연결되지 않았습니다";
      default: return "재연결";
    }
  })();

  return (
    <div className="contact-detail">
      <div className="contact-detail-header">
        <h3>연락처 상세</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={`status-badge ${contact.status}`}>{statusText}</span>
          {contact.status !== "connected" && (
            <button
              className="btn-secondary"
              onClick={handleDial}
              disabled={!hasAddresses || dialState === "dialing"}
              title={!hasAddresses ? "초대에 주소가 포함되지 않았습니다" : "재연결 시도"}
              style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "2px 8px" }}
            >
              <RefreshCw size={12} className={dialState === "dialing" ? "spinning" : ""} />
              {dialButtonLabel}
            </button>
          )}
        </div>
      </div>

      <div className="form-group">
        <label>표시 이름</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>에이전트 이름</label>
        <input type="text" value={contact.agent_name} readOnly disabled />
      </div>

      {contact.agent_description && (
        <div className="form-group">
          <label>설명</label>
          <input type="text" value={contact.agent_description} readOnly disabled />
        </div>
      )}

      <div className="form-group">
        <label>바인딩된 에이전트</label>
        <select
          value={localAgentId}
          onChange={(e) => setLocalAgentId(e.target.value)}
        >
          <option value="">선택 안 함</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <span className="form-text">이 연락처의 메시지에 응답할 에이전트</span>
      </div>

      <div className="form-group">
        <label>모드</label>
        <input type="text" value="비서 (Secretary)" readOnly disabled />
        <span className="form-text">대리인 모드는 Phase 2에서 지원 예정</span>
      </div>

      <div className="contact-detail-actions">
        {hasChanges && (
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? "저장 중..." : "저장"}
          </button>
        )}
        {!confirmDelete ? (
          <button
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} />
            연락처 삭제
          </button>
        ) : (
          <div className="confirm-delete-row">
            <span>정말 삭제하시겠습니까?</span>
            <button className="btn-danger" onClick={handleDelete}>삭제</button>
            <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>취소</button>
          </div>
        )}
      </div>
    </div>
  );
}
