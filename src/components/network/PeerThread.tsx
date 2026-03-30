import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, SquarePen } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useMessageScroll } from "../../hooks/useMessageScroll";
import PeerMessageBubble from "./PeerMessageBubble";
import PeerChatInput from "./PeerChatInput";
import DraggableHeader from "../layout/DraggableHeader";

type TabKey = "my" | "incoming";

export default function PeerThread() {
  const { t } = useTranslation("network");
  const messages = useNetworkStore((s) => s.messages);
  const selectedThreadId = useNetworkStore((s) => s.selectedThreadId);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const contacts = useNetworkStore((s) => s.contacts);
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);
  const clearThreadMessages = useNetworkStore((s) => s.clearThreadMessages);
  const clearMyChatMessages = useNetworkStore((s) => s.clearMyChatMessages);

  const [activeTab, setActiveTab] = useState<TabKey>("my");
  const [confirmClear, setConfirmClear] = useState(false);

  const contact = contacts.find((c) => c.id === selectedContactId);
  const isOnline = contact ? connectedPeers.has(contact.peer_id) : false;

  // "My chat" = messages I sent manually + responses to those messages
  const myMessages = useMemo(() => {
    const mySentIds = new Set(
      messages
        .filter((m) => m.direction === "outgoing" && !m.responding_agent_id)
        .map((m) => m.message_id_unique),
    );
    return messages.filter((msg) => {
      if (msg.direction === "outgoing" && !msg.responding_agent_id) return true;
      if (msg.direction === "incoming" && msg.correlation_id && mySentIds.has(msg.correlation_id)) return true;
      return false;
    });
  }, [messages]);

  // "Incoming" = messages the peer sent + my agent's auto-responses
  const incomingMessages = useMemo(() => {
    const peerSentIds = new Set(
      messages
        .filter((m) => m.direction === "incoming" && !m.correlation_id)
        .map((m) => m.message_id_unique),
    );
    return messages.filter((msg) => {
      // Peer's incoming messages (not responses to my messages)
      if (msg.direction === "incoming" && !msg.correlation_id) return true;
      // My agent's auto-responses (outgoing with responding_agent_id, correlated to peer messages)
      if (msg.direction === "outgoing" && msg.responding_agent_id) return true;
      // Also include outgoing responses that correlate to peer-sent messages
      if (msg.direction === "outgoing" && msg.correlation_id && peerSentIds.has(msg.correlation_id)) return true;
      return false;
    });
  }, [messages]);

  const displayMessages = activeTab === "my" ? myMessages : incomingMessages;

  const { messagesEndRef, messagesContainerRef } = useMessageScroll(
    [selectedThreadId, activeTab],
    [displayMessages],
  );

  return (
    <div className="peer-thread">
      <DraggableHeader className="peer-thread-header">
        <div className="peer-thread-agent-info">
          <span className="peer-thread-agent-name">
            {contact?.display_name || contact?.agent_name || t("peer.unknown")}
          </span>
          <span className={`peer-thread-status ${isOnline ? "online" : "offline"}`}>
            {isOnline ? t("peer.online") : t("peer.offline")}
          </span>
        </div>
        <div className="peer-thread-actions">
          {selectedThreadId && activeTab === "my" && myMessages.length > 0 && (
            <button
              className="icon-btn"
              onClick={() => clearMyChatMessages(selectedThreadId)}
              title={t("peer.newConversation")}
            >
              <SquarePen size={16} />
            </button>
          )}
          {selectedThreadId && (
            <button
              className={`icon-btn${confirmClear ? " confirm" : ""}`}
              onClick={() => {
                if (confirmClear) {
                  clearThreadMessages(selectedThreadId);
                  setConfirmClear(false);
                } else {
                  setConfirmClear(true);
                  setTimeout(() => setConfirmClear(false), 3000);
                }
              }}
              title={confirmClear ? t("common:confirm") : t("peer.clearHistory")}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </DraggableHeader>

      {/* Tab bar */}
      <div className="peer-thread-tabs">
        <button
          className={`peer-thread-tab${activeTab === "my" ? " active" : ""}`}
          onClick={() => setActiveTab("my")}
        >
          {t("peer.tabMyChat")}
        </button>
        <button
          className={`peer-thread-tab${activeTab === "incoming" ? " active" : ""}`}
          onClick={() => setActiveTab("incoming")}
        >
          {t("peer.tabIncoming")}
          {incomingMessages.length > 0 && (
            <span className="peer-thread-tab-count">{incomingMessages.length}</span>
          )}
        </button>
      </div>

      {/* Read-only banner for incoming tab */}
      {activeTab === "incoming" && (
        <div className="peer-thread-readonly-banner">
          {t("peer.incomingReadOnly")}
        </div>
      )}

      <div className="peer-thread-messages" ref={messagesContainerRef}>
        {displayMessages.length === 0 ? (
          <div className="peer-thread-no-messages">
            {activeTab === "my" ? t("peer.noMyMessages") : t("peer.noIncomingMessages")}
          </div>
        ) : (
          displayMessages.map((msg) => <PeerMessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Only show input on "my chat" tab */}
      {activeTab === "my" && <PeerChatInput />}
    </div>
  );
}
