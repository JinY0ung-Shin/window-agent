import type { Message } from "../../services/types";
import { cn, formatTime } from "../../lib/utils";

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex gap-3 px-4 py-2", isUser ? "flex-row-reverse" : "")}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5",
          isUser
            ? "bg-surface-600"
            : "bg-accent-500/15"
        )}
      >
        {isUser ? "👤" : "👩‍💼"}
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
