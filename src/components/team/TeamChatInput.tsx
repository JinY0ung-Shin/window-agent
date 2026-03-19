import React, { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Send, Square } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useTeamChatFlowStore } from "../../stores/teamChatFlowStore";
import { useTeamRunStore } from "../../stores/teamRunStore";
import TeamStatusBar from "./TeamStatusBar";

export default function TeamChatInput() {
  const { t } = useTranslation("team");
  const inputValue = useMessageStore((s) => s.inputValue);
  const setInputValue = useMessageStore((s) => s.setInputValue);
  const sendTeamMessage = useTeamChatFlowStore((s) => s.sendTeamMessage);
  const abortCurrentRun = useTeamChatFlowStore((s) => s.abortCurrentRun);
  const activeRuns = useTeamRunStore((s) => s.activeRuns);
  const messages = useMessageStore((s) => s.messages);

  const hasActiveRun = Object.values(activeRuns).some(
    (r) => r.status === "running" || r.status === "waiting_reports",
  );
  const isSending = messages.some(
    (m) => m.status === "pending" || m.status === "streaming",
  );
  const isBusy = hasActiveRun || isSending;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);
  const [localValue, setLocalValue] = useState(inputValue);

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

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setLocalValue(val);
      if (!isComposing.current) {
        setInputValue(val);
      }
    },
    [setInputValue],
  );

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      isComposing.current = false;
      const val = (e.target as HTMLTextAreaElement).value;
      setLocalValue(val);
      setInputValue(val);
    },
    [setInputValue],
  );

  const flushAndSend = useCallback(() => {
    setInputValue(localValue);
    sendTeamMessage();
  }, [localValue, setInputValue, sendTeamMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
      e.preventDefault();
      flushAndSend();
    }
  };

  return (
    <div className="input-area">
      <TeamStatusBar />
      <div className="input-container">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={
            isBusy ? t("chat.inputBusy") : t("chat.inputPlaceholder")
          }
          value={localValue}
          rows={1}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposing.current = true;
          }}
          onCompositionEnd={handleCompositionEnd}
          disabled={isBusy}
        />
        {isBusy ? (
          <button
            className="send-button cancel"
            onClick={abortCurrentRun}
            title={t("chat.abortTitle")}
          >
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
