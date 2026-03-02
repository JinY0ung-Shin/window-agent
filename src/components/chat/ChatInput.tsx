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
      className="p-3 border-t border-surface-700 bg-surface-800/80 backdrop-blur-sm"
    >
      <div className="flex gap-2 items-end">
        <textarea
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!activeChannelId || streaming}
          placeholder={
            activeChannelId ? "메시지를 입력하세요..." : "채널을 선택하세요"
          }
          className="flex-1 bg-surface-900 border border-surface-600 rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 transition-all disabled:opacity-50 resize-none min-h-[42px] max-h-[120px] overflow-y-auto leading-relaxed"
        />
        <button
          type="submit"
          disabled={!value.trim() || streaming || !activeChannelId}
          className="w-10 h-10 rounded-xl bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:hover:bg-accent-500 text-white flex items-center justify-center transition-all hover:shadow-lg hover:shadow-accent-500/20"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </div>
    </form>
  );
}
