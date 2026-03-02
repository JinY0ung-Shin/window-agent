import { useChatStore } from "../../stores/chatStore";
import { AvatarBadge } from "../ui/AvatarBadge";

interface StreamingMessageProps {
  name: string;
  avatar?: string;
}

export function StreamingMessage({ name, avatar }: StreamingMessageProps) {
  const streamingContent = useChatStore((s) => s.streamingContent);

  return (
    <div className="flex gap-3.5 px-5 py-3">
      <AvatarBadge name={name} avatar={avatar} size="lg" className="mt-0.5" />
      <div className="max-w-[78%] min-w-0">
        <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-surface-700 px-6 py-3.5 shadow-sm">
          {streamingContent ? (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-text-primary">
              {streamingContent}
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent-400" />
            </p>
          ) : (
            <div className="flex min-w-[32px] items-center gap-1.5 py-0.5">
              <div
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted"
                style={{ animationDelay: "0ms" }}
              />
              <div
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
