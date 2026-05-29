import { i18n } from "../../i18n";
import type { PeerMessageRow } from "../../services/commands/relayCommands";
import { useNetworkStore } from "../../stores/networkStore";
import DeliveryBadge from "./DeliveryBadge";
import MessageBody from "../chat/MessageBody";

export default function PeerMessageBubble({ msg }: { msg: PeerMessageRow }) {
  const isOutgoing = msg.direction === "outgoing";
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const resendMessage = useNetworkStore((s) => s.resendMessage);

  const time = (() => {
    try {
      const d = new Date(msg.created_at);
      const intlLocale = i18n.language === "en" ? "en-US" : "ko-KR";
      return d.toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  })();

  const handleRetry =
    isOutgoing && msg.delivery_state === "failed" && selectedContactId
      ? () => {
          void resendMessage(selectedContactId, msg.content, msg.target_agent_id);
        }
      : undefined;

  return (
    <div className={`peer-msg ${isOutgoing ? "outgoing" : "incoming"}`}>
      <div className="peer-msg-bubble">
        {!isOutgoing && msg.responding_agent_id && (
          <div className="peer-msg-agent-tag">
            {msg.sender_agent !== "local" ? msg.sender_agent : msg.responding_agent_id.slice(0, 8)}
          </div>
        )}
        <div className="peer-msg-content">
          <MessageBody content={msg.content} />
        </div>
        <div className="peer-msg-meta">
          <span className="peer-msg-time">{time}</span>
          {isOutgoing && (
            <DeliveryBadge state={msg.delivery_state} onRetry={handleRetry} />
          )}
        </div>
      </div>
    </div>
  );
}
