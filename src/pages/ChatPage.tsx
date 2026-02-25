import { useEffect } from "react";
import { useChatStore } from "../stores/chatStore";
import { ChannelList } from "../components/chat/ChannelList";
import { ChatWindow } from "../components/chat/ChatWindow";

export function ChatPage() {
  const fetchChannels = useChatStore((s) => s.fetchChannels);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  return (
    <div className="h-full flex">
      <ChannelList />
      <ChatWindow />
    </div>
  );
}
