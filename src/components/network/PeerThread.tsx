import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Eye, EyeOff, Trash2 } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useMessageScroll } from "../../hooks/useMessageScroll";
import PeerMessageBubble from "./PeerMessageBubble";
import PeerChatInput from "./PeerChatInput";
import ContactDetail from "./ContactDetail";
import DraggableHeader from "../layout/DraggableHeader";

interface PeerThreadProps {
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

export default function PeerThread({ settingsOpen, onToggleSettings }: PeerThreadProps) {
  const { t } = useTranslation("network");
  const messages = useNetworkStore((s) => s.messages);
  const selectedThreadId = useNetworkStore((s) => s.selectedThreadId);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const contacts = useNetworkStore((s) => s.contacts);
  const connectedPeers = useNetworkStore((s) => s.connectedPeers);
  const showAllMessages = useNetworkStore((s) => s.showAllMessages);
  const toggleShowAllMessages = useNetworkStore((s) => s.toggleShowAllMessages);
  const clearThreadMessages = useNetworkStore((s) => s.clearThreadMessages);

  const contact = contacts.find((c) => c.id === selectedContactId);
  const isOnline = contact ? connectedPeers.has(contact.peer_id) : false;

  // Filter: "내 대화" = 내가 보낸 메시지 + 그에 대한 상대방 응답만
  const filteredMessages = useMemo(() => {
    if (showAllMessages) return messages;
    // Collect message_id_unique of messages I sent manually (outgoing + no responding_agent_id)
    const mySentIds = new Set(
      messages
        .filter((m) => m.direction === "outgoing" && !m.responding_agent_id)
        .map((m) => m.message_id_unique),
    );
    return messages.filter((msg) => {
      // My manually sent messages
      if (msg.direction === "outgoing" && !msg.responding_agent_id) return true;
      // Responses to my messages (incoming with correlation to my sent)
      if (msg.direction === "incoming" && msg.correlation_id && mySentIds.has(msg.correlation_id)) return true;
      return false;
    });
  }, [messages, showAllMessages]);

  const { messagesEndRef, messagesContainerRef } = useMessageScroll(
    [selectedThreadId],
    [filteredMessages],
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
          <button
            className={`icon-btn${showAllMessages ? " active" : ""}`}
            onClick={toggleShowAllMessages}
            title={showAllMessages ? t("peer.showMyChats") : t("peer.showAllChats")}
          >
            {showAllMessages ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          {selectedThreadId && (
            <button
              className="icon-btn"
              onClick={() => clearThreadMessages(selectedThreadId)}
              title={t("peer.clearHistory")}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            className={`icon-btn${settingsOpen ? " active" : ""}`}
            onClick={onToggleSettings}
            title={t("contact.detailTitle")}
          >
            <Settings size={16} />
          </button>
        </div>
      </DraggableHeader>

      {settingsOpen && (
        <div className="peer-thread-settings">
          <ContactDetail />
        </div>
      )}

      <div className="peer-thread-messages" ref={messagesContainerRef}>
        {filteredMessages.length === 0 ? (
          <div className="peer-thread-no-messages">
            {showAllMessages ? t("peer.noMessages") : t("peer.noMyMessages")}
          </div>
        ) : (
          filteredMessages.map((msg) => <PeerMessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      <PeerChatInput />
    </div>
  );
}
