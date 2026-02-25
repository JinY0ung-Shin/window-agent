import { useEffect, useRef } from "react";
import { useChatStore } from "../../stores/chatStore";
import { ChatMessage } from "./ChatMessage";
import { StreamingMessage } from "./StreamingMessage";
import { ChatInput } from "./ChatInput";

export function ChatWindow() {
  const { messages, streaming, activeChannelId } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  if (!activeChannelId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-muted">채널을 선택하세요</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 overflow-auto py-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-text-muted">메시지가 없습니다</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {streaming && <StreamingMessage />}
        <div ref={bottomRef} />
      </div>
      <ChatInput />
    </div>
  );
}
