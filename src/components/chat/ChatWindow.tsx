import { useEffect, useRef } from "react";
import { useChatStore } from "../../stores/chatStore";
import { ChatMessage } from "./ChatMessage";
import { StreamingMessage } from "./StreamingMessage";
import { ChatInput } from "./ChatInput";

const agentEmoji: Record<string, string> = {
  "김비서": "👩‍💼",
  "박개발": "💻",
  "이분석": "📊",
  "최기획": "📝",
  "정조사": "🔍",
  "한디자": "🎨",
  "강관리": "📁",
  "윤자동": "🔧",
};

export function ChatWindow() {
  const { messages, streaming, activeChannelId, channels } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const channelName = activeChannel?.name || "에이전트";
  const channelAvatar = activeChannel?.avatar || agentEmoji[channelName] || "🤖";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  if (!activeChannelId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8 rounded-2xl bg-surface-800/40 border border-surface-700/50">
          <div className="text-4xl mb-4 opacity-60">💬</div>
          <p className="text-sm font-medium text-text-secondary">채널을 선택하세요</p>
          <p className="text-xs text-text-muted mt-1.5">좌측에서 에이전트를 선택하여 대화를 시작합니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface-900">
      {/* Channel Header Bar */}
      <div className="h-12 px-4 flex items-center gap-3 border-b border-surface-700 bg-surface-800/50 backdrop-blur-sm shrink-0">
        <div className="w-8 h-8 rounded-full bg-surface-700/60 flex items-center justify-center text-base">
          {channelAvatar}
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary">{channelName}</p>
          <p className="text-[10px] text-success">응답 대기 중</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto py-4 pr-1">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-6 rounded-2xl bg-surface-800/30 border border-surface-700/40 max-w-xs mx-auto">
              <div className="text-3xl mb-3">{channelAvatar}</div>
              <p className="text-sm text-text-secondary font-medium">안녕하세요, {channelName}입니다</p>
              <p className="text-xs text-text-muted mt-1">무엇을 도와드릴까요?</p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} agentAvatar={channelAvatar} />
        ))}
        {streaming && <StreamingMessage avatar={channelAvatar} />}
        <div ref={bottomRef} />
      </div>
      <ChatInput />
    </div>
  );
}
