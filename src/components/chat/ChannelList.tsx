import { useChatStore } from "../../stores/chatStore";
import { cn, formatDate } from "../../lib/utils";

export function ChannelList() {
  const { channels, activeChannelId, setActiveChannel } = useChatStore();

  return (
    <div className="w-56 border-r border-surface-700 bg-surface-800 flex flex-col">
      <div className="p-3 border-b border-surface-700">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          채널
        </h2>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => setActiveChannel(ch.id)}
            className={cn(
              "w-full text-left px-3 py-2.5 transition-colors",
              activeChannelId === ch.id
                ? "bg-accent-500/10"
                : "hover:bg-surface-700"
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-accent-500/20 flex items-center justify-center text-xs text-accent-400 font-medium shrink-0">
                {ch.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary truncate">
                    {ch.name}
                  </span>
                  {ch.unreadCount > 0 && (
                    <span className="ml-1 w-4 h-4 rounded-full bg-accent-500 text-[10px] text-white flex items-center justify-center shrink-0">
                      {ch.unreadCount}
                    </span>
                  )}
                </div>
                {ch.lastMessage && (
                  <p className="text-[11px] text-text-muted truncate mt-0.5">
                    {ch.lastMessage}
                  </p>
                )}
                {ch.lastMessageAt && (
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {formatDate(ch.lastMessageAt)}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
