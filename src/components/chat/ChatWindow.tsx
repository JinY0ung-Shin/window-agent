import { useTranslation } from "react-i18next";
import { X, Plus } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useAgentStore } from "../../stores/agentStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { useStreamStore } from "../../stores/streamStore";
import { useSettingsStore } from "../../stores/settingsStore";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import SkillBar from "../skill/SkillBar";
import ToolRunBlock from "./ToolRunBlock";
import ToolRunGroup from "./ToolRunGroup";
import ConversationSwitcher from "./ConversationSwitcher";
import OnboardingAnimation from "./OnboardingAnimation";

import { useNavigationStore } from "../../stores/navigationStore";
import { useDragRegion } from "../../hooks/useDragRegion";
import { useMessageScroll } from "../../hooks/useMessageScroll";
import { buildChatRenderBlocks, groupConsecutiveToolRuns } from "./chatRenderBlocks";

export default function ChatWindow() {
  const messages = useMessageStore((s) => s.messages);
  const conversations = useConversationStore((s) => s.conversations);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const isBootstrapping = useBootstrapStore((s) => s.isBootstrapping);
  const isOnboarding = useBootstrapStore((s) => s.isOnboarding);
  const cancelBootstrap = useBootstrapStore((s) => s.cancelBootstrap);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);
  const openEditor = useAgentStore((s) => s.openEditor);
  const setMainView = useNavigationStore((s) => s.setMainView);
  const { t } = useTranslation("glossary");
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const companyName = useSettingsStore((s) => s.companyName);

  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const pendingToolCalls = useToolRunStore((s) => s.pendingToolCalls);
  const activeRun = useStreamStore((s) => s.activeRun);
  const startNewAgentConversation = useConversationStore((s) => s.startNewAgentConversation);
  const isBusy = activeRun !== null || toolRunState !== "idle";

  const { messagesEndRef, messagesContainerRef } = useMessageScroll(
    [currentConversationId, selectedAgentId, isBootstrapping],
    [messages, toolRunState, activeRun?.status],
  );

  // Show agent selector when no conversation, no agent selected, and not bootstrapping/onboarding
  const showSelector =
    !currentConversationId &&
    messages.length === 0 &&
    !selectedAgentId &&
    !isBootstrapping &&
    !isOnboarding;

  // Resolve the agent for the current context (conversation or selected).
  // Falls through to selectedAgentId when the conversation is not yet in the list
  // (e.g. optimistic new conversation before loadConversations()).
  const currentAgentId = (() => {
    if (currentConversationId) {
      const conv = conversations.find((c) => c.id === currentConversationId);
      if (conv) return conv.agent_id;
    }
    return selectedAgentId;
  })();
  const currentAgent = currentAgentId
    ? agents.find((a) => a.id === currentAgentId) ?? null
    : null;
  const { onMouseDown: onDrag, onDoubleClick: onDragDblClick } = useDragRegion();
  const renderBlocks = groupConsecutiveToolRuns(
    buildChatRenderBlocks(messages, toolRunState, pendingToolCalls),
  );

  return (
    <main className="main-area">
      <header className="chat-header" onMouseDown={onDrag} onDoubleClick={onDragDblClick}>
        <ConversationSwitcher />
        {currentAgent && (
          <>
            <button
              className={`header-new-conv-btn ${isBusy ? "disabled" : ""}`}
              onClick={() => { if (!isBusy) startNewAgentConversation(currentAgent.id); }}
              disabled={isBusy}
              title={t("common:newConversation")}
            >
              <Plus size={16} />
            </button>
            <button
              className="header-agent-btn"
              onClick={() => { setMainView("agent"); openEditor(currentAgent.id); }}
              title={t("editAgent", { context: uiTheme })}
            >
              {currentAgent.avatar ? (
                <img src={currentAgent.avatar} alt={currentAgent.name} className="header-agent-avatar" />
              ) : null}
              <span>{currentAgent.name}</span>
            </button>
          </>
        )}
        {isBootstrapping && (
          <button
            className="bootstrap-cancel-btn"
            onClick={cancelBootstrap}
            title={t("common:cancel")}
          >
            <X size={18} />
          </button>
        )}
      </header>

      <div className="chat-container" ref={messagesContainerRef}>
        {isOnboarding ? (
          <OnboardingAnimation />
        ) : showSelector ? (
          <div className="agent-selector">
            <div className="agent-selector-header">
              <h2>{t("appTitle", { companyName, context: uiTheme })}</h2>
              <p>{t("chatSelectOrHire", { context: uiTheme })}</p>
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
                  {t("bootstrapPrompt", { context: uiTheme })}
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

              if (block.type === "tool_run_group") {
                return <ToolRunGroup key={block.key} runs={block.runs} />;
              }

              return <ChatMessage key={block.key} message={block.message} />;
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {!showSelector && !isOnboarding && <ChatInput />}
    </main>
  );
}
