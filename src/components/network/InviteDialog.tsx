import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, Loader2, Search, UserPlus } from "lucide-react";
import Modal from "../common/Modal";
import { useClipboardFeedback } from "../../hooks/useClipboardFeedback";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";
import { toErrorMessage } from "../../utils/errorUtils";
import type { DirectoryPeer } from "../../services/commands/relayCommands";

type Tab = "search" | "generate" | "accept";

interface Props {
  onClose: () => void;
}

export default function InviteDialog({ onClose }: Props) {
  const { t } = useTranslation("network");
  const [tab, setTab] = useState<Tab>("search");

  return (
    <Modal
      onClose={onClose}
      title={tab === "search" ? t("directory.searchTab") : t("invite.title")}
      overlayClose="stopPropagation"
      contentClassName="invite-dialog"
    >
      <div className="invite-tabs">
          <button
            className={`invite-tab${tab === "search" ? " active" : ""}`}
            onClick={() => setTab("search")}
          >
            {t("directory.searchTab")}
          </button>
          <button
            className={`invite-tab${tab === "generate" ? " active" : ""}`}
            onClick={() => setTab("generate")}
          >
            {t("invite.generate")}
          </button>
          <button
            className={`invite-tab${tab === "accept" ? " active" : ""}`}
            onClick={() => setTab("accept")}
          >
            {t("invite.accept")}
          </button>
        </div>

      {tab === "search" ? (
        <PeerSearchTab onClose={onClose} t={t} />
      ) : tab === "generate" ? (
        <GenerateTab onClose={onClose} t={t} />
      ) : (
        <AcceptTab onClose={onClose} t={t} />
      )}
    </Modal>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function PeerSearchTab({ t }: { onClose: () => void; t: TFn }) {
  const agents = useAgentStore((s) => s.agents);
  const searchDirectory = useNetworkStore((s) => s.searchDirectory);
  const sendFriendRequest = useNetworkStore((s) => s.sendFriendRequest);
  const directoryResults = useNetworkStore((s) => s.directoryResults);
  const directoryLoading = useNetworkStore((s) => s.directoryLoading);
  const contacts = useNetworkStore((s) => s.contacts);

  const [query, setQuery] = useState("");
  const [sentPeers, setSentPeers] = useState<Set<string>>(new Set());
  const [sendingPeer, setSendingPeer] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Known peer_ids from existing contacts
  const knownPeerIds = useMemo(
    () => new Set(contacts.map((c) => c.peer_id)),
    [contacts],
  );

  // Debounced search
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      searchDirectory(query.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchDirectory]);

  const handleSend = useCallback(async (peer: DirectoryPeer) => {
    setSendingPeer(peer.peer_id);
    setError("");
    try {
      await sendFriendRequest(peer, agents[0]?.id);
      setSentPeers((prev) => new Set(prev).add(peer.peer_id));
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSendingPeer(null);
    }
  }, [sendFriendRequest, agents]);

  return (
    <div className="invite-tab-content">
      <div className="form-group">
        <div className="search-input-wrap">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("directory.searchPlaceholder")}
            autoFocus
          />
        </div>
      </div>

      {error && <div className="form-text text-error">{error}</div>}

      <div className="directory-results">
        {directoryLoading && (
          <div className="directory-empty">
            <Loader2 size={20} className="spinning" />
          </div>
        )}
        {!directoryLoading && query.trim() && directoryResults.length === 0 && (
          <div className="directory-empty">{t("directory.noResults")}</div>
        )}
        {!directoryLoading &&
          directoryResults.map((peer) => {
            const isKnown = knownPeerIds.has(peer.peer_id);
            const isSent = sentPeers.has(peer.peer_id);
            const isSending = sendingPeer === peer.peer_id;
            return (
              <div key={peer.peer_id} className="directory-peer-card">
                <div className="directory-peer-info">
                  <div className="directory-peer-name">
                    <span className={`status-dot ${peer.is_online ? "online" : "offline"}`} />
                    {peer.agent_name || `Peer ${peer.peer_id.slice(0, 8)}`}
                  </div>
                  {peer.agent_description && (
                    <div className="directory-peer-desc">{peer.agent_description}</div>
                  )}
                  <div className="directory-peer-id">{peer.peer_id.slice(0, 12)}...</div>
                </div>
                <div className="directory-peer-action">
                  {isKnown ? (
                    <span className="directory-badge known">{t("peer.approved")}</span>
                  ) : isSent ? (
                    <span className="directory-badge sent">{t("directory.requestSent")}</span>
                  ) : (
                    <button
                      className="btn-sm btn-primary"
                      onClick={() => handleSend(peer)}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <Loader2 size={14} className="spinning" />
                      ) : (
                        <><UserPlus size={14} /> {t("directory.sendRequest")}</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function GenerateTab({ onClose, t }: { onClose: () => void; t: TFn }) {
  const agents = useAgentStore((s) => s.agents);
  const generateInvite = useNetworkStore((s) => s.generateInvite);

  const [selectedAgentIdx, setSelectedAgentIdx] = useState(0);
  const [description, setDescription] = useState("");
  const [expiryHours, setExpiryHours] = useState(24);
  const [inviteCode, setInviteCode] = useState("");
  const { copied, copy } = useClipboardFeedback(2000);
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
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => copy(inviteCode);

  return (
    <div className="invite-tab-content">
      {!inviteCode ? (
        <>
          <div className="form-group">
            <label>{t("invite.representativeAgent")}</label>
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
            <label>{t("invite.descriptionOptional")}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("invite.descriptionPlaceholder")}
            />
          </div>
          <div className="form-group">
            <label>{t("invite.expiry")}</label>
            <select
              value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))}
            >
              <option value={24}>{t("invite.hours24")}</option>
              <option value={48}>{t("invite.hours48")}</option>
              <option value={168}>{t("invite.week1")}</option>
              <option value={0}>{t("invite.noExpiry")}</option>
            </select>
          </div>

          {error && <div className="form-text text-error">{error}</div>}
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={loading || agents.length === 0}
          >
            {loading ? <Loader2 size={16} className="spinning" /> : t("invite.generateButton")}
          </button>
        </>
      ) : (
        <>
          <div className="form-group">
            <label>{t("invite.codeLabel")}</label>
            <div className="invite-code-box">
              <textarea readOnly value={inviteCode} rows={4} />
              <button className="icon-btn copy-btn" onClick={handleCopy} title={t("common:copy")}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <span className="form-text">{t("invite.shareHint")}</span>
          </div>
          <button className="btn-secondary" onClick={onClose}>{t("common:close")}</button>
        </>
      )}
    </div>
  );
}

interface InvitePreview {
  agent_name?: string;
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
      };
    }
  } catch {
    // Decode failed — not a valid invite yet
  }
  return null;
}

function AcceptTab({ onClose, t }: { onClose: () => void; t: TFn }) {
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
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="invite-tab-content">
      <div className="form-group">
        <label>{t("invite.pasteLabel")}</label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={4}
          placeholder={t("invite.pastePlaceholder")}
        />
      </div>
      {preview && (
        <div className="invite-preview">
          <span className="invite-preview-badge">{t("invite.unverified")}</span>
          {preview.agent_name && (
            <div className="invite-preview-row">{t("invite.agentPrefix", { name: preview.agent_name })}</div>
          )}
        </div>
      )}
      <div className="form-group">
        <label>{t("invite.bindingAgent")}</label>
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
        >
          <option value="">{t("invite.noSelection")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <span className="form-text">{t("invite.bindingHint")}</span>
      </div>
      {error && <div className="form-text text-error">{error}</div>}
      <button
        className="btn-primary"
        onClick={handleAccept}
        disabled={loading || !code.trim()}
      >
        {loading ? <Loader2 size={16} className="spinning" /> : t("invite.acceptButton")}
      </button>
    </div>
  );
}
