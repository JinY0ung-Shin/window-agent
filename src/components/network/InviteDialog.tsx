import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search, UserPlus } from "lucide-react";
import Modal from "../common/Modal";
import { useNetworkStore } from "../../stores/networkStore";
import { toErrorMessage } from "../../utils/errorUtils";
import type { DirectoryPeer } from "../../services/commands/relayCommands";

interface Props {
  onClose: () => void;
}

export default function InviteDialog({ onClose }: Props) {
  const { t } = useTranslation("network");

  const searchDirectory = useNetworkStore((s) => s.searchDirectory);
  const sendFriendRequest = useNetworkStore((s) => s.sendFriendRequest);
  const directoryResults = useNetworkStore((s) => s.directoryResults);
  const directoryLoading = useNetworkStore((s) => s.directoryLoading);
  const contacts = useNetworkStore((s) => s.contacts);

  const [query, setQuery] = useState("");
  const [sentPeers, setSentPeers] = useState<Set<string>>(new Set());
  const [sendingPeer, setSendingPeer] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [initialLoaded, setInitialLoaded] = useState(false);

  // Known peer_ids from existing contacts
  const knownPeerIds = useMemo(
    () => new Set(contacts.map((c) => c.peer_id)),
    [contacts],
  );

  // Track previous query to avoid duplicate requests
  const [prevQuery, setPrevQuery] = useState<string | null>(null);

  // Load all peers on mount
  useEffect(() => {
    if (!initialLoaded) {
      searchDirectory("");
      setPrevQuery("");
      setInitialLoaded(true);
    }
  }, [initialLoaded, searchDirectory]);

  // Debounced search on query change
  useEffect(() => {
    if (!initialLoaded) return;
    const trimmed = query.trim();
    if (trimmed === prevQuery) return;
    const timer = setTimeout(() => {
      searchDirectory(trimmed);
      setPrevQuery(trimmed);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchDirectory, initialLoaded]);

  const handleSend = useCallback(async (peer: DirectoryPeer) => {
    setSendingPeer(peer.peer_id);
    setError("");
    try {
      await sendFriendRequest(peer);
      setSentPeers((prev) => new Set(prev).add(peer.peer_id));
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSendingPeer(null);
    }
  }, [sendFriendRequest]);

  return (
    <Modal
      onClose={onClose}
      title={t("directory.title")}
      overlayClose="stopPropagation"
      contentClassName="invite-dialog"
    >
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
          {!directoryLoading && directoryResults.length === 0 && (
            <div className="directory-empty">
              {query.trim() ? t("directory.noResults") : t("directory.noPeers")}
            </div>
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
                    {peer.agents && peer.agents.length > 0 && (
                      <div className="directory-peer-agents">
                        {peer.agents.map((a) => (
                          <span key={a.agent_id} className="agent-chip">{a.name}</span>
                        ))}
                      </div>
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
    </Modal>
  );
}
