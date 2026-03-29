import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
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

  const contact = contacts.find((c) => c.id === selectedContactId);
  const isOnline = contact ? connectedPeers.has(contact.peer_id) : false;

  const { messagesEndRef, messagesContainerRef } = useMessageScroll(
    [selectedThreadId],
    [messages],
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
        <button
          className={`icon-btn${settingsOpen ? " active" : ""}`}
          onClick={onToggleSettings}
          title={t("contact.detailTitle")}
        >
          <Settings size={16} />
        </button>
      </DraggableHeader>

      {settingsOpen && (
        <div className="peer-thread-settings">
          <ContactDetail />
        </div>
      )}

      <div className="peer-thread-messages" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="peer-thread-no-messages">
            {t("peer.noMessages")}
          </div>
        ) : (
          messages.map((msg) => <PeerMessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      <PeerChatInput />
    </div>
  );
}
