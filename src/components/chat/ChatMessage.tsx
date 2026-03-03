import { Bot, User } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../../services/types";

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const isLoading = message.isLoading;

  return (
    <div className={`message ${message.type} ${isLoading ? "loading" : ""}`}>
      <div className="avatar">
        {message.type === "agent" ? (
          <Bot size={22} color="#6366f1" />
        ) : (
          <User size={22} />
        )}
      </div>
      <div className="bubble">
        {isLoading ? (
          <span className="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </span>
        ) : (
          message.content
        )}
      </div>
    </div>
  );
}
