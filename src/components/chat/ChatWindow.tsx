import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import AgentSelector from "../agent/AgentSelector";
import AgentEditor from "../agent/AgentEditor";
import MemoryBar from "../memory/MemoryBar";
import SkillBar from "../skill/SkillBar";

export default function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const isBootstrapping = useChatStore((s) => s.isBootstrapping);
  const cancelBootstrap = useChatStore((s) => s.cancelBootstrap);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const isNearBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  useEffect(() => {
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages]);

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null;

  const currentTitle = isBootstrapping
    ? "새 에이전트 만들기"
    : currentConversationId
      ? conversations.find((c) => c.id === currentConversationId)?.title ?? "대화"
      : selectedAgent
        ? selectedAgent.name
        : "업무 보조 에이전트";

  // Show agent selector when no conversation, no agent selected, and not bootstrapping
  const showSelector =
    !currentConversationId &&
    messages.length === 0 &&
    !selectedAgentId &&
    !isBootstrapping;

  return (
    <main className="main-area">
      <header className="chat-header">
        <div className="header-title">{currentTitle}</div>
        {isBootstrapping && (
          <button
            className="bootstrap-cancel-btn"
            onClick={cancelBootstrap}
            title="취소"
          >
            <X size={18} />
          </button>
        )}
      </header>

      <div className="chat-container" ref={messagesContainerRef}>
        {showSelector ? (
          <AgentSelector />
        ) : (
          <>
            {!isBootstrapping && (() => {
              const conv = conversations.find((c) => c.id === currentConversationId);
              const agentId = conv?.agent_id ?? selectedAgentId;
              if (!agentId) return null;
              return (
                <>
                  <MemoryBar agentId={agentId} />
                  <SkillBar agentId={agentId} />
                </>
              );
            })()}
            {messages.length === 0 && isBootstrapping && (
              <div className="message agent">
                <div className="avatar">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 8V4H8" />
                    <rect width="16" height="12" x="4" y="8" rx="2" />
                    <path d="M2 14h2" />
                    <path d="M20 14h2" />
                    <path d="M15 13v2" />
                    <path d="M9 13v2" />
                  </svg>
                </div>
                <div className="bubble">
                  어떤 에이전트를 만들고 싶나요? 이름, 성격, 역할 등을 자유롭게 말해주세요.
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {!showSelector && <ChatInput />}

      {/* Agent editor modal (rendered here so it overlays everything) */}
      <AgentEditor />
    </main>
  );
}
