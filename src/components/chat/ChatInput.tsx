import React, { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Send, Square, GraduationCap } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useChatFlowStore } from "../../stores/chatFlowStore";
import { useStreamStore } from "../../stores/streamStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";

export default function ChatInput() {
  const { t } = useTranslation("chat");
  const inputValue = useMessageStore((s) => s.inputValue);
  const setInputValue = useMessageStore((s) => s.setInputValue);
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);

  // Local buffer so the textarea always reflects the latest value including
  // intermediate IME composition states. The Zustand store is only updated
  // when NOT composing (or on compositionEnd) to prevent React re-renders
  // from resetting the textarea value mid-composition.
  const [localValue, setLocalValue] = useState(inputValue);

  // Sync store → local when the store changes externally
  // (e.g. input cleared after sending a message)
  useEffect(() => {
    if (!isComposing.current) {
      setLocalValue(inputValue);
    }
  }, [inputValue]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [localValue, adjustHeight]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    if (!isComposing.current) {
      setInputValue(val);
    }
  }, [setInputValue]);

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposing.current = false;
    const val = (e.target as HTMLTextAreaElement).value;
    setLocalValue(val);
    setInputValue(val);
  }, [setInputValue]);

  // Flush localValue to the store before delegating to chatFlowStore.sendMessage(),
  // so the store always has the latest text even if composition just ended.
  const flushAndSend = useCallback(() => {
    setInputValue(localValue);
    sendMessage();
  }, [localValue, setInputValue, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
      e.preventDefault();
      flushAndSend();
    }
  };

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
          ref={textareaRef}
          className="chat-input"
          placeholder={placeholder}
          value={localValue}
          rows={1}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposing.current = true; }}
          onCompositionEnd={handleCompositionEnd}
          disabled={isToolBusy}
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
