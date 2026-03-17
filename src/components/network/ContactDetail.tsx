import { useState } from "react";
import { Trash2, Save } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";
import {
  p2pUpdateContact,
  p2pRemoveContact,
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
    display_name: string;
    agent_name: string;
    agent_description: string;
    local_agent_id: string | null;
    mode: string;
    status: string;
  };
  agents: { id: string; name: string }[];
  onDeselect: () => void;
  onRefresh: () => Promise<void>;
}

function ContactDetailInner({ contact, agents, onDeselect, onRefresh }: InnerProps) {
  const [displayName, setDisplayName] = useState(contact.display_name);
  const [localAgentId, setLocalAgentId] = useState(contact.local_agent_id ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  return (
    <div className="contact-detail">
      <div className="contact-detail-header">
        <h3>연락처 상세</h3>
        <span className={`status-badge ${contact.status}`}>{statusText}</span>
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
