import { useState } from "react";
import { Bot, User, ChevronDown, ChevronRight } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../../services/types";

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const isLoading = message.isLoading;
  const [showReasoning, setShowReasoning] = useState(false);

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
          <>
            {message.reasoningContent && (
              <div className="reasoning-toggle" onClick={() => setShowReasoning(!showReasoning)}>
                {showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>추론 과정</span>
              </div>
            )}
            {showReasoning && message.reasoningContent && (
              <div className="reasoning-content">{message.reasoningContent}</div>
            )}
            {message.content}
          </>
        )}
      </div>
    </div>
  );
}
