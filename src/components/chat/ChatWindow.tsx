import { useRef, useEffect } from "react";
import { useChatStore } from "../../stores/chatStore";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";

export default function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const currentTitle = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId)?.title ?? "대화"
    : "업무 보조 에이전트";

  return (
    <main className="main-area">
      <header className="chat-header">
        <div className="header-title">{currentTitle}</div>
      </header>

      <div className="chat-container">
        {messages.length === 0 && (
          <div className="message agent">
            <div className="avatar">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
              </svg>
            </div>
            <div className="bubble">
              안녕하세요! 원하시는 작업을 말씀해 주세요. 어떤 것을 도와드릴까요?
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput />
    </main>
  );
}
