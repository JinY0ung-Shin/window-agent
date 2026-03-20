import { useTranslation } from "react-i18next";
import { Send, Square, GraduationCap } from "lucide-react";
import { useChatFlowStore } from "../../stores/chatFlowStore";
import { useStreamStore } from "../../stores/streamStore";
import { useMessageStore } from "../../stores/messageStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useChatInputLogic } from "../../hooks/useChatInputLogic";

export default function ChatInput() {
  const { t } = useTranslation("chat");
  const sendMessage = useChatFlowStore((s) => s.sendMessage);
  const abortStream = useStreamStore((s) => s.abortStream);
  const messages = useMessageStore((s) => s.messages);
  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const isSending = messages.some((m) => m.status === "pending" || m.status === "streaming");
  const isToolBusy = toolRunState === "tool_waiting" || toolRunState === "tool_running" || toolRunState === "continuing";
  const learningMode = useConversationStore((s) => s.getCurrentLearningMode());
  const toggleLearningMode = useConversationStore((s) => s.toggleLearningMode);
  const learningModeWarning = useConversationStore((s) => s.learningModeWarning);
  const dismissWarning = useConversationStore((s) => s.dismissLearningModeWarning);
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const isBusy = isSending || isToolBusy;

  const { textareaProps, localValue, flushAndSend } = useChatInputLogic({
    sendFn: sendMessage,
    disabled: isToolBusy,
  });

  const placeholder = toolRunState === "tool_waiting"
    ? t("input.placeholder.toolWaiting")
    : toolRunState === "tool_running"
      ? t("input.placeholder.toolRunning")
      : toolRunState === "continuing"
        ? t("input.placeholder.toolContinuing")
        : t("input.placeholder.idle");

  const learningModeLabel = t("glossary:learningMode", { context: uiTheme });
  const learningModeTooltip = t("chat:learningMode.tooltip", { context: uiTheme });
  const learningModeWarningText = t("chat:learningMode.warning", { context: uiTheme });

  return (
    <div className="input-area">
      <div className="input-toolbar">
        <button
          className={`learning-mode-toggle${learningMode ? " active" : ""}`}
          onClick={toggleLearningMode}
          disabled={isBusy}
          title={learningMode ? learningModeTooltip : learningModeLabel}
        >
          <GraduationCap size={16} />
          {learningMode && <span className="learning-mode-label">{learningModeLabel}</span>}
        </button>
        {learningModeWarning && (
          <span className="learning-mode-warning" onClick={dismissWarning}>
            {learningModeWarningText}
          </span>
        )}
      </div>
      <div className="input-container">
        <textarea
          {...textareaProps}
          className="chat-input"
          placeholder={placeholder}
        />
        {isSending || isToolBusy ? (
          <button className="send-button cancel" onClick={abortStream} title={t("input.cancelTitle")}>
            <Square size={18} />
          </button>
        ) : (
          <button
            className="send-button"
            onClick={flushAndSend}
            disabled={!localValue.trim()}
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
