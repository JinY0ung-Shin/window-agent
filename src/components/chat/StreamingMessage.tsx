import { useChatStore } from "../../stores/chatStore";
import { AvatarBadge } from "../ui/AvatarBadge";

interface StreamingMessageProps {
  name: string;
  avatar?: string;
}

export function StreamingMessage({ name, avatar }: StreamingMessageProps) {
  const streamingContent = useChatStore((s) => s.streamingContent);

  return (
    <div className="flex gap-4 px-6 py-3.5 animate-fadeIn">
      <AvatarBadge name={name} avatar={avatar} size="lg" className="mt-0.5" />
      <div className="max-w-[78%] min-w-0">
        <div className="rounded-xl rounded-tl-sm border border-white/[0.06] bg-surface-700/50 px-5 py-4 backdrop-blur-sm">
          {streamingContent ? (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-text-primary">
              {streamingContent}
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-gradient-to-b from-accent-400 to-cyan-400" />
            </p>
          ) : (
            <div className="flex min-w-[32px] items-center gap-1.5 py-0.5">
              <div
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-400"
                style={{ animationDelay: "0ms" }}
              />
              <div
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-400/70"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-400/40"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
