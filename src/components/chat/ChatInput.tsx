import React from "react";
import { Send } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";

export default function ChatInput() {
  const inputValue = useChatStore((s) => s.inputValue);
  const setInputValue = useChatStore((s) => s.setInputValue);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const messages = useChatStore((s) => s.messages);
  const isSending = messages.some((m) => m.isLoading);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="input-area">
      <div className="input-container">
        <input
          type="text"
          className="chat-input"
          placeholder="메시지를 입력하세요..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="send-button"
          onClick={sendMessage}
          disabled={!inputValue.trim() || isSending}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
