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
    <div>
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        빠른 지시
      </h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="김비서에게 지시하기..."
          className="flex-1 bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-500 transition-colors"
        />
        <button
          type="submit"
          className="bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          전송
        </button>
      </form>
    </div>
  );
}
