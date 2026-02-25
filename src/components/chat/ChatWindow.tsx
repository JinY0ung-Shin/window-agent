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
        <div className="text-center">
          <div className="text-5xl mb-3">💬</div>
          <p className="text-sm text-text-muted">채널을 선택하세요</p>
          <p className="text-[10px] text-text-muted mt-1">좌측에서 에이전트를 선택하여 대화를 시작합니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Channel Header Bar */}
      <div className="h-12 px-4 flex items-center gap-3 border-b border-surface-700 bg-surface-800/50 backdrop-blur-sm shrink-0">
        <div className="w-7 h-7 rounded-full bg-surface-700/60 flex items-center justify-center text-sm">
          👩‍💼
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary">김비서</p>
          <p className="text-[10px] text-success">응답 대기 중</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto py-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-4xl mb-3">👩‍💼</div>
              <p className="text-sm text-text-secondary font-medium">안녕하세요, 김비서입니다</p>
              <p className="text-xs text-text-muted mt-1">무엇을 도와드릴까요?</p>
            </div>
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
