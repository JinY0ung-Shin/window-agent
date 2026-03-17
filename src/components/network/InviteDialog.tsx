import { useState } from "react";
import { X, Copy, Check, Loader2 } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";

type Tab = "generate" | "accept";

interface Props {
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: "24시간", value: 24 },
  { label: "48시간", value: 48 },
  { label: "1주일", value: 168 },
  { label: "만료 없음", value: 0 },
];

export default function InviteDialog({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("generate");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content invite-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>초대 코드</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="invite-tabs">
          <button
            className={`invite-tab${tab === "generate" ? " active" : ""}`}
            onClick={() => setTab("generate")}
          >
            생성
          </button>
          <button
            className={`invite-tab${tab === "accept" ? " active" : ""}`}
            onClick={() => setTab("accept")}
          >
            수락
          </button>
        </div>

        {tab === "generate" ? (
          <GenerateTab onClose={onClose} />
        ) : (
          <AcceptTab onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function GenerateTab({ onClose }: { onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const generateInvite = useNetworkStore((s) => s.generateInvite);

  const [selectedAgentIdx, setSelectedAgentIdx] = useState(0);
  const [description, setDescription] = useState("");
  const [expiryHours, setExpiryHours] = useState(24);
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    const agent = agents[selectedAgentIdx];
    if (!agent) return;
    setLoading(true);
    setError("");
    try {
      const code = await generateInvite(
        agent.name,
        description || agent.description,
        expiryHours === 0 ? undefined : expiryHours,
      );
      setInviteCode(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="invite-tab-content">
      {!inviteCode ? (
        <>
          <div className="form-group">
            <label>대표 에이전트</label>
            <select
              value={selectedAgentIdx}
              onChange={(e) => setSelectedAgentIdx(Number(e.target.value))}
            >
              {agents.map((a, i) => (
                <option key={a.id} value={i}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>설명 (선택)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="상대방에게 보여줄 설명"
            />
          </div>
          <div className="form-group">
            <label>유효 기간</label>
            <select
              value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {error && <div className="form-text text-error">{error}</div>}
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={loading || agents.length === 0}
          >
            {loading ? <Loader2 size={16} className="spinning" /> : "생성"}
          </button>
        </>
      ) : (
        <>
          <div className="form-group">
            <label>초대 코드</label>
            <div className="invite-code-box">
              <textarea readOnly value={inviteCode} rows={4} />
              <button className="icon-btn copy-btn" onClick={handleCopy} title="복사">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <span className="form-text">이 코드를 상대방에게 전달하세요.</span>
          </div>
          <button className="btn-secondary" onClick={onClose}>닫기</button>
        </>
      )}
    </div>
  );
}

function AcceptTab({ onClose }: { onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const acceptInvite = useNetworkStore((s) => s.acceptInvite);

  const [code, setCode] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAccept = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      await acceptInvite(code.trim(), selectedAgentId || undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="invite-tab-content">
      <div className="form-group">
        <label>초대 코드 붙여넣기</label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={4}
          placeholder="상대방에게서 받은 초대 코드를 입력하세요"
        />
      </div>
      <div className="form-group">
        <label>바인딩할 에이전트</label>
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
        >
          <option value="">선택 안 함</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <span className="form-text">이 연락처에 응답할 로컬 에이전트를 선택합니다.</span>
      </div>
      {error && <div className="form-text text-error">{error}</div>}
      <button
        className="btn-primary"
        onClick={handleAccept}
        disabled={loading || !code.trim()}
      >
        {loading ? <Loader2 size={16} className="spinning" /> : "수락"}
      </button>
    </div>
  );
}
