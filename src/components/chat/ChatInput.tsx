import React, { useRef, useCallback, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";

export default function ChatInput() {
  const inputValue = useChatStore((s) => s.inputValue);
  const setInputValue = useChatStore((s) => s.setInputValue);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortStream = useChatStore((s) => s.abortStream);
  const messages = useChatStore((s) => s.messages);
  const toolRunState = useChatStore((s) => s.toolRunState);
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
