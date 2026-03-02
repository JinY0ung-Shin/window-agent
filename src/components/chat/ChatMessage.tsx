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
    <div className={cn("flex gap-3.5 px-5 py-3", isUser && "flex-row-reverse")}>
      {isUser ? (
        <AvatarBadge
          name="대표"
          size="lg"
          className="mt-0.5 border-accent-500/25 from-accent-500/35 to-accent-400/10"
        />
      ) : (
        <AvatarBadge name={agentName} avatar={agentAvatar} size="lg" className="mt-0.5" />
      )}

      <div className={cn("min-w-0 max-w-[78%]", isUser && "text-right")}>
        <div
          className={cn(
            "inline-block max-w-full rounded-2xl px-6 py-3.5 text-sm leading-relaxed shadow-sm",
            isUser
              ? "rounded-tr-sm bg-accent-500 text-white"
              : "rounded-tl-sm border border-white/[0.08] bg-surface-700 text-text-primary"
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
