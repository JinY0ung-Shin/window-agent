import { useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";

export function QuickCommand() {
  const [value, setValue] = useState("");
  const send = useChatStore((s) => s.send);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const setActivePage = useUiStore((s) => s.setActivePage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;

    await setActiveChannel("ch-kim");
    await send(value.trim());
    setValue("");
    setActivePage("chat");
  };

  return (
    <div className="card">
      <h2 className="section-title">
        <span>⚡</span>
        <span>빠른 지시</span>
      </h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="김비서에게 지시하기..."
          className="flex-1 bg-surface-900 border border-surface-600 rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 transition-all"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="bg-accent-500 hover:bg-accent-600 hover:shadow-lg hover:shadow-accent-500/20 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent-500 disabled:hover:shadow-none"
        >
          전송
        </button>
      </form>
    </div>
  );
}
