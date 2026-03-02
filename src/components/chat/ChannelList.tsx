import { useChatStore } from "../../stores/chatStore";
import { cn, formatDate } from "../../lib/utils";
import { AvatarBadge } from "../ui/AvatarBadge";
import { AppIcon } from "../ui/AppIcon";

export function ChannelList() {
  const { channels, activeChannelId, setActiveChannel } = useChatStore();

  return (
    <aside className="flex w-[296px] flex-col border-r border-white/[0.08] bg-surface-800/92">
      <div className="shrink-0 border-b border-white/[0.08] px-5 py-4">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-text-primary">
          <AppIcon name="chat" size={16} className="text-accent-400" />
          채널
        </h2>
        <p className="mt-1 text-xs text-text-muted">에이전트와 실시간으로 대화하세요</p>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {channels.map((ch) => {
          const isActive = activeChannelId === ch.id;
          return (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={cn(
                "relative mb-2 w-full rounded-2xl border px-3.5 py-3 text-left transition-colors",
                isActive
                  ? "border-accent-500/35 bg-accent-500/11"
                  : "border-transparent hover:border-white/[0.08] hover:bg-surface-700/75"
              )}
            >
              <div className="flex items-center gap-3">
                <AvatarBadge name={ch.name} avatar={ch.avatar} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-[15px] font-medium",
                        isActive ? "text-accent-400" : "text-text-primary"
                      )}
                    >
                      {ch.name}
                    </span>
                    {ch.unreadCount > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[11px] text-white">
                        {ch.unreadCount}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="line-clamp-1 text-xs text-text-muted">
                      {ch.lastMessage || "대화를 시작하세요"}
                    </p>
                    {ch.lastMessageAt && (
                      <span className="shrink-0 text-[11px] text-text-muted">
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
    </aside>
  );
}
