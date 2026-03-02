import { useChatStore } from "../../stores/chatStore";
import { cn, formatDate } from "../../lib/utils";

const channelEmoji: Record<string, string> = {
  "김비서": "👩‍💼",
  "박개발": "💻",
  "이분석": "📊",
  "최기획": "📝",
  "정조사": "🔍",
  "한디자": "🎨",
  "강관리": "📁",
  "윤자동": "🔧",
};

export function ChannelList() {
  const { channels, activeChannelId, setActiveChannel } = useChatStore();

  return (
    <div className="w-64 border-r border-surface-700 bg-surface-800 flex flex-col">
      <div className="h-12 px-4 flex items-center border-b border-surface-700 shrink-0">
        <div>
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <span>💬</span>
            채널
          </h2>
          <p className="text-[10px] text-text-muted mt-0.5">에이전트와 대화하세요</p>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-2 px-2">
        {channels.map((ch) => {
          const emoji = ch.avatar || channelEmoji[ch.name] || "🤖";
          const isActive = activeChannelId === ch.id;
          return (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-xl transition-all mb-1 relative",
                isActive
                  ? "bg-accent-500/10 border border-accent-500/30"
                  : "hover:bg-surface-700 border border-transparent"
              )}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-surface-700/60 flex items-center justify-center text-lg shrink-0">
                  {emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "text-sm font-medium truncate",
                      isActive ? "text-accent-400" : "text-text-primary"
                    )}>
                      {ch.name}
                    </span>
                    {ch.unreadCount > 0 && (
                      <span className="ml-1 min-w-[18px] h-[18px] rounded-full bg-accent-500 text-[10px] text-white flex items-center justify-center shrink-0 px-1">
                        {ch.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-[11px] text-text-muted truncate flex-1">
                      {ch.lastMessage || "대화를 시작하세요"}
                    </p>
                    {ch.lastMessageAt && (
                      <span className="text-[10px] text-text-muted ml-2 shrink-0">
                        {formatDate(ch.lastMessageAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
