import { useEffect, useRef } from "react";
import { useChatStore } from "../../stores/chatStore";
import { ChatMessage } from "./ChatMessage";
import { StreamingMessage } from "./StreamingMessage";
import { ChatInput } from "./ChatInput";
import { AvatarBadge } from "../ui/AvatarBadge";
import { AppIcon } from "../ui/AppIcon";

export function ChatWindow() {
  const { messages, streaming, activeChannelId, channels } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const channelName = activeChannel?.name || "에이전트";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  if (!activeChannelId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface-900/40">
        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-surface-700/60 to-surface-800/60 p-10 text-center backdrop-blur-xl animate-scaleIn">
          <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/20 to-cyan-500/10 text-accent-400 shadow-[0_0_16px_rgba(124,58,237,0.12)]">
            <AppIcon name="chat" size={20} />
          </span>
          <p className="text-base font-medium text-text-primary">채널을 선택하세요</p>
          <p className="mt-1.5 text-sm text-text-muted">좌측 목록에서 에이전트를 선택해 대화를 시작합니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface-900/30">
      <div className="flex h-14 items-center gap-3 border-b border-white/[0.06] bg-surface-800/50 px-5 backdrop-blur-xl">
        <AvatarBadge name={channelName} avatar={activeChannel?.avatar} size="lg" />
        <div>
          <p className="text-[15px] font-medium text-text-primary">{channelName}</p>
          <p className="text-xs text-success">응답 가능</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto py-5 pr-1">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center px-5">
            <div className="mx-auto max-w-sm rounded-2xl border border-white/[0.06] bg-gradient-to-b from-surface-700/50 to-surface-800/50 p-8 text-center backdrop-blur-xl animate-fadeIn">
              <div className="mb-3 flex justify-center">
                <AvatarBadge name={channelName} avatar={activeChannel?.avatar} size="lg" className="h-12 w-12 text-base" />
              </div>
              <p className="text-base font-medium text-text-secondary">안녕하세요, {channelName}입니다</p>
              <p className="mt-1.5 text-sm text-text-muted">무엇을 도와드릴까요?</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            agentName={channelName}
            agentAvatar={activeChannel?.avatar}
          />
        ))}

        {streaming && <StreamingMessage name={channelName} avatar={activeChannel?.avatar} />}
        <div ref={bottomRef} />
      </div>
      <ChatInput />
    </div>
  );
}
