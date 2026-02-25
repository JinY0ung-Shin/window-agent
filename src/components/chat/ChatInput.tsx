import { useState } from "react";
import { useChatStore } from "../../stores/chatStore";

export function ChatInput() {
  const [value, setValue] = useState("");
  const { send, streaming, activeChannelId } = useChatStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || streaming || !activeChannelId) return;
    const msg = value.trim();
    setValue("");
    await send(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 border-t border-surface-700 bg-surface-800"
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!activeChannelId || streaming}
          placeholder={
            activeChannelId ? "메시지를 입력하세요..." : "채널을 선택하세요"
          }
          className="flex-1 bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-500 transition-colors disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!value.trim() || streaming || !activeChannelId}
          className="bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:hover:bg-accent-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          전송
        </button>
      </div>
    </form>
  );
}
