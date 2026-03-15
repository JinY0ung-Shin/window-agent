import React, { useRef, useCallback, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useChatFlowStore } from "../../stores/chatFlowStore";
import { useStreamStore } from "../../stores/streamStore";
import { useToolRunStore } from "../../stores/toolRunStore";

export default function ChatInput() {
  const inputValue = useMessageStore((s) => s.inputValue);
  const setInputValue = useMessageStore((s) => s.setInputValue);
  const sendMessage = useChatFlowStore((s) => s.sendMessage);
  const abortStream = useStreamStore((s) => s.abortStream);
  const messages = useMessageStore((s) => s.messages);
  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const isSending = messages.some((m) => m.status === "pending" || m.status === "streaming");
  const isToolBusy = toolRunState === "tool_waiting" || toolRunState === "tool_running" || toolRunState === "continuing";

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [inputValue, adjustHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
      e.preventDefault();
      sendMessage();
    }
  };

  const placeholder = toolRunState === "tool_waiting"
    ? "도구 승인 대기 중..."
    : toolRunState === "tool_running"
      ? "도구 실행 중..."
      : toolRunState === "continuing"
        ? "도구 결과 처리 중..."
        : "메시지를 입력하세요...";

  return (
    <div className="input-area">
      <div className="input-container">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={placeholder}
          value={inputValue}
          rows={1}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposing.current = true; }}
          onCompositionEnd={() => { isComposing.current = false; }}
          disabled={isToolBusy}
        />
        {isSending || isToolBusy ? (
          <button className="send-button cancel" onClick={abortStream} title="취소">
            <Square size={18} />
          </button>
        ) : (
          <button
            className="send-button"
            onClick={sendMessage}
            disabled={!inputValue.trim()}
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
