import type { Message } from "../../services/types";
import { cn, formatTime } from "../../lib/utils";

interface ChatMessageProps {
  message: Message;
  agentAvatar?: string;
}

export function ChatMessage({ message, agentAvatar }: ChatMessageProps) {
  const isUser = message.role === "user";
  const avatar = isUser ? "👤" : (agentAvatar || "🤖");

  return (
    <div
      className={cn("flex gap-3 px-4 py-2", isUser ? "flex-row-reverse" : "")}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5",
          isUser
            ? "bg-accent-500/20"
            : "bg-accent-500/15"
        )}
      >
        {avatar}
      </div>
      <div className={cn("max-w-[70%] min-w-0", isUser ? "text-right" : "")}>
        <div
          className={cn(
            "inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
            isUser
              ? "bg-accent-500 text-white rounded-tr-sm"
              : "bg-surface-700 text-text-primary rounded-tl-sm"
          )}
        >
          <span className="whitespace-pre-wrap">{message.content}</span>
        </div>
        <p
          className={cn(
            "text-[10px] text-text-muted mt-1 px-1",
            isUser ? "text-right" : ""
          )}
        >
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
