import { useChatStore } from "../../stores/chatStore";

export function StreamingMessage() {
  const streamingContent = useChatStore((s) => s.streamingContent);

  return (
    <div className="flex gap-3 px-4 py-2">
      <div className="w-7 h-7 rounded-full bg-accent-500/20 flex items-center justify-center text-xs text-accent-400 font-medium shrink-0 mt-0.5">
        김
      </div>
      <div className="bg-surface-700 rounded-xl rounded-tl-sm px-3.5 py-2.5 max-w-[75%]">
        {streamingContent ? (
          <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
            {streamingContent}
            <span className="inline-block w-1.5 h-4 bg-accent-400 ml-0.5 animate-pulse" />
          </p>
        ) : (
          <div className="flex gap-1.5 items-center">
            <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
      </div>
    </div>
  );
}
