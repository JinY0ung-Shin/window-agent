import { useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useAgentStore } from "../../stores/agentStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { useStreamStore } from "../../stores/streamStore";
import { useLabels, useCompanyName } from "../../hooks/useLabels";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import AgentEditor from "../agent/AgentEditor";
import SkillBar from "../skill/SkillBar";
import ToolRunBlock from "./ToolRunBlock";
import { buildChatRenderBlocks } from "./chatRenderBlocks";

export default function ChatWindow() {
  const messages = useMessageStore((s) => s.messages);
  const conversations = useConversationStore((s) => s.conversations);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const isBootstrapping = useBootstrapStore((s) => s.isBootstrapping);
  const cancelBootstrap = useBootstrapStore((s) => s.cancelBootstrap);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);
  const openEditor = useAgentStore((s) => s.openEditor);
  const labels = useLabels();
  const companyName = useCompanyName();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const pendingToolCalls = useToolRunStore((s) => s.pendingToolCalls);
  const activeRun = useStreamStore((s) => s.activeRun);

  const wasNearBottomRef = useRef(true);

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  // Track scroll position — remember if user was near bottom
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => { wasNearBottomRef.current = isNearBottom(); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isNearBottom]);

  // Auto-scroll on any relevant state change
  useEffect(() => {
    if (wasNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, toolRunState, activeRun?.status, scrollToBottom]);

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null;

  const currentTitle = isBootstrapping
    ? labels.bootstrapTitle
    : currentConversationId
      ? conversations.find((c) => c.id === currentConversationId)?.title ?? "대화"
      : selectedAgent
        ? selectedAgent.name
        : labels.appTitle(companyName);

  // Show agent selector when no conversation, no agent selected, and not bootstrapping
  const showSelector =
    !currentConversationId &&
    messages.length === 0 &&
    !selectedAgentId &&
    !isBootstrapping;

  // Resolve the agent for the current context (conversation or selected)
  const currentAgentId = (() => {
    if (currentConversationId) {
      const conv = conversations.find((c) => c.id === currentConversationId);
      return conv?.agent_id ?? null;
    }
    return selectedAgentId;
  })();
  const currentAgent = currentAgentId
    ? agents.find((a) => a.id === currentAgentId) ?? null
    : null;
  const renderBlocks = buildChatRenderBlocks(messages, toolRunState, pendingToolCalls);

  return (
    <main className="main-area">
      <header className="chat-header">
        <div className="header-title">{currentTitle}</div>
        {currentAgent && (
          <button
            className="header-agent-btn"
            onClick={() => openEditor(currentAgent.id)}
            title={labels.editAgent}
          >
            {currentAgent.avatar ? (
              <img src={currentAgent.avatar} alt="" className="header-agent-avatar" />
            ) : null}
            <span>{currentAgent.name}</span>
          </button>
        )}
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
          <div className="agent-selector">
            <div className="agent-selector-header">
              <h2>{labels.appTitle(companyName)}</h2>
              <p>{labels.chatSelectOrHire}</p>
            </div>
          </div>
        ) : (
          <>
            {!isBootstrapping && (() => {
              const conv = conversations.find((c) => c.id === currentConversationId);
              const agentId = conv?.agent_id ?? selectedAgentId;
              if (!agentId) return null;
              return <SkillBar agentId={agentId} />;
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
                  {labels.bootstrapPrompt}
                </div>
              </div>
            )}
            {renderBlocks.map((block) => {
              if (block.type === "tool_run") {
                return (
                  <ToolRunBlock
                    key={block.key}
                    assistantMessage={block.assistantMessage}
                    leadingContent={block.leadingContent}
                    steps={block.steps}
                    isActiveRun={block.isActiveRun}
                  />
                );
              }

              return <ChatMessage key={block.key} message={block.message} />;
            })}
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
