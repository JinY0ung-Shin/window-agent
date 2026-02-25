import { useChatStore } from "../../stores/chatStore";

interface StreamingMessageProps {
  avatar?: string;
}

export function StreamingMessage({ avatar }: StreamingMessageProps) {
  const streamingContent = useChatStore((s) => s.streamingContent);
  const displayAvatar = avatar || "🤖";

  return (
    <div className="flex gap-3 px-4 py-2">
      <div className="w-8 h-8 rounded-full bg-accent-500/15 flex items-center justify-center text-sm shrink-0 mt-0.5">
        {displayAvatar}
      </div>
      <div className="max-w-[70%]">
        <div className="bg-surface-700 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
          {streamingContent ? (
            <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
              {streamingContent}
              <span className="inline-block w-1.5 h-4 bg-accent-400 ml-0.5 animate-pulse rounded-sm" />
            </p>
          ) : (
            <div className="flex gap-1.5 items-center py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
