import type { Message } from "../../services/types";
import { cn, formatTime } from "../../lib/utils";
import { AvatarBadge } from "../ui/AvatarBadge";

interface ChatMessageProps {
  message: Message;
  agentName?: string;
  agentAvatar?: string;
}

export function ChatMessage({
  message,
  agentName = "Agent",
  agentAvatar,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-4 px-6 py-3.5 animate-slideUp", isUser && "flex-row-reverse")}>
      {isUser ? (
        <AvatarBadge
          name="대표"
          size="lg"
          className="mt-0.5"
        />
      ) : (
        <AvatarBadge name={agentName} avatar={agentAvatar} size="lg" className="mt-0.5" />
      )}

      <div className={cn("min-w-0 max-w-[78%]", isUser && "text-right")}>
        <div
          className={cn(
            "inline-block max-w-full rounded-xl px-5 py-4 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)]"
              : "rounded-tl-sm border border-white/[0.06] bg-surface-700/50 text-text-primary backdrop-blur-sm"
          )}
        >
          <span className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {message.content}
          </span>
        </div>
        <p className={cn("mt-1.5 px-1 text-[11px] text-text-muted", isUser && "text-right")}>
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
