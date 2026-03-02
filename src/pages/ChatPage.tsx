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
      <div className="flex h-full overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-800/40 backdrop-blur-xl shadow-[0_22px_40px_rgba(0,0,0,0.3),0_0_30px_rgba(124,58,237,0.04)]">
        <ChannelList />
        <ChatWindow />
      </div>
    </PageShell>
  );
}
