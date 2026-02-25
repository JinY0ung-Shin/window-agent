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
          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 mt-0.5",
          isUser
            ? "bg-surface-600 text-text-secondary"
            : "bg-accent-500/20 text-accent-400"
        )}
      >
        {isUser ? "나" : "김"}
      </div>
      <div className={cn("max-w-[70%] min-w-0", isUser ? "text-right" : "")}>
        <div
          className={cn(
            "inline-block rounded-xl px-3.5 py-2 text-sm leading-relaxed",
            isUser
              ? "bg-accent-500 text-white rounded-tr-sm"
              : "bg-surface-700 text-text-primary rounded-tl-sm"
          )}
        >
          {message.content}
        </div>
        <p
          className={cn(
            "text-[10px] text-text-muted mt-1",
            isUser ? "text-right" : ""
          )}
        >
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
