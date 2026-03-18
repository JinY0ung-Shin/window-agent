import { useState, useEffect, useMemo } from "react";
import { X, Copy, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";
import { p2pGetConnectionInfo, type ConnectionInfo } from "../../services/commands/p2pCommands";

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

  // Connection info for address selection
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);
  const [connInfoLoading, setConnInfoLoading] = useState(true);
  const [selectedLanAddrs, setSelectedLanAddrs] = useState<Set<string>>(new Set());
  const [manualAddrs, setManualAddrs] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    setConnInfoLoading(true);
    p2pGetConnectionInfo()
      .then((info) => {
        if (cancelled) return;
        setConnInfo(info);
        // Pre-select all LAN addresses
        setSelectedLanAddrs(new Set(info.listen_addresses));
      })
      .catch(() => {
        if (!cancelled) setConnInfo(null);
      })
      .finally(() => {
        if (!cancelled) setConnInfoLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const toggleLanAddr = (addr: string) => {
    setSelectedLanAddrs((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
  };

  const addManualAddr = () => {
    const raw = manualInput.trim();
    if (!raw) return;

    let addr = raw;
    // Auto-convert plain IP to multiaddr
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
      const port = connInfo?.active_listen_port ?? connInfo?.configured_listen_port;
      if (!port) {
        setManualInput(raw);
        return;
      }
      addr = `/ip4/${raw}/tcp/${port}`;
    }

    if (!manualAddrs.includes(addr)) {
      setManualAddrs((prev) => [...prev, addr]);
    }
    setManualInput("");
  };

  const removeManualAddr = (addr: string) => {
    setManualAddrs((prev) => prev.filter((a) => a !== addr));
  };

  const handleGenerate = async () => {
    const agent = agents[selectedAgentIdx];
    if (!agent) return;
    setLoading(true);
    setError("");
    try {
      const addresses = [...selectedLanAddrs, ...manualAddrs];
      const code = await generateInvite(
        agent.name,
        description || agent.description,
        addresses,
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

          {/* Address selection */}
          <div className="form-group">
            <label>연결 주소</label>
            {connInfoLoading ? (
              <span className="form-text"><Loader2 size={14} className="spinning" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />주소 감지 중...</span>
            ) : connInfo && connInfo.listen_addresses.length > 0 ? (
              <div className="addr-checkbox-list">
                {connInfo.listen_addresses.map((addr) => (
                  <label key={addr} className="addr-checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedLanAddrs.has(addr)}
                      onChange={() => toggleLanAddr(addr)}
                    />
                    <code className="addr-text">{addr}</code>
                    <span className="addr-badge">LAN</span>
                  </label>
                ))}
              </div>
            ) : (
              <span className="form-text">감지된 LAN 주소 없음</span>
            )}
          </div>

          <div className="form-group">
            <label>공인 주소 추가</label>
            <div className="addr-manual-input">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualAddr(); } }}
                placeholder={`/ip4/공인IP/tcp/${connInfo?.active_listen_port ?? "포트"}`}
              />
              <button
                className="btn-secondary addr-add-btn"
                onClick={addManualAddr}
                disabled={!manualInput.trim()}
              >
                <Plus size={14} />
                추가
              </button>
            </div>
            <span className="form-text">IP만 입력하면 자동으로 Multiaddr로 변환됩니다.</span>
            {manualAddrs.length > 0 && (
              <div className="addr-manual-list">
                {manualAddrs.map((addr) => (
                  <div key={addr} className="addr-manual-item">
                    <code className="addr-text">{addr}</code>
                    <button className="icon-btn" onClick={() => removeManualAddr(addr)} title="제거">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
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

interface InvitePreview {
  agent_name?: string;
  addresses?: string[];
}

function tryDecodeInvite(code: string): InvitePreview | null {
  try {
    const trimmed = code.trim();
    if (!trimmed) return null;
    // URL-safe base64 no-padding → standard base64
    let b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding
    while (b64.length % 4 !== 0) b64 += "=";
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const obj = JSON.parse(json);
    if (typeof obj === "object" && obj !== null) {
      return {
        agent_name: obj.agent_name,
        addresses: Array.isArray(obj.addresses) ? obj.addresses : undefined,
      };
    }
  } catch {
    // Decode failed — not a valid invite yet
  }
  return null;
}

function AcceptTab({ onClose }: { onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const acceptInvite = useNetworkStore((s) => s.acceptInvite);

  const [code, setCode] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => tryDecodeInvite(code), [code]);

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
      {preview && (
        <div className="invite-preview">
          <span className="invite-preview-badge">미검증</span>
          {preview.agent_name && (
            <div className="invite-preview-row">에이전트: {preview.agent_name}</div>
          )}
          <div className="invite-preview-row">
            {preview.addresses && preview.addresses.length > 0
              ? `연결 주소 ${preview.addresses.length}개 포함`
              : "주소 없음 — 같은 네트워크에서만 연결 가능"}
          </div>
        </div>
      )}
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
