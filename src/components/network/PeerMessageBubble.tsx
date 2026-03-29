import { i18n } from "../../i18n";
import type { PeerMessageRow } from "../../services/commands/relayCommands";
import DeliveryBadge from "./DeliveryBadge";
import MessageBody from "../chat/MessageBody";

export default function PeerMessageBubble({ msg }: { msg: PeerMessageRow }) {
  const isOutgoing = msg.direction === "outgoing";

  const time = (() => {
    try {
      const d = new Date(msg.created_at);
      const intlLocale = i18n.language === "en" ? "en-US" : "ko-KR";
      return d.toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  })();

  return (
    <div className={`peer-msg ${isOutgoing ? "outgoing" : "incoming"}`}>
      <div className="peer-msg-bubble">
        <div className="peer-msg-content">
          <MessageBody content={msg.content} />
        </div>
        <div className="peer-msg-meta">
          <span className="peer-msg-time">{time}</span>
          {isOutgoing && (
            <DeliveryBadge state={msg.delivery_state} />
          )}
        </div>
      </div>
    </div>
  );
}
