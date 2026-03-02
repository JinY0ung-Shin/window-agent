import { useEffect } from "react";
import { useChatStore } from "../stores/chatStore";
import { ChannelList } from "../components/chat/ChannelList";
import { ChatWindow } from "../components/chat/ChatWindow";
import { PageShell } from "../components/ui/PageShell";

export function ChatPage() {
  const fetchChannels = useChatStore((s) => s.fetchChannels);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  return (
    <PageShell className="h-full pt-3 pb-3">
      <div className="flex h-full overflow-hidden rounded-3xl border border-white/[0.08] bg-surface-800/56 shadow-[0_22px_40px_rgba(0,0,0,0.26)]">
        <ChannelList />
        <ChatWindow />
      </div>
    </PageShell>
  );
}
