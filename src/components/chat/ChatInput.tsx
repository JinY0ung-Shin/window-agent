import { useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import { Button } from "../ui/Button";
import { AppIcon } from "../ui/AppIcon";

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
      className="border-t border-white/[0.08] bg-surface-800/82 p-4 backdrop-blur-sm"
    >
      <div className="flex items-end gap-2.5">
        <textarea
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!activeChannelId || streaming}
          placeholder={activeChannelId ? "메시지를 입력하세요..." : "채널을 선택하세요"}
          className="min-h-[50px] max-h-[150px] flex-1 resize-none overflow-y-auto rounded-xl border border-white/[0.08] bg-surface-900 px-4 py-3 text-sm leading-relaxed text-text-primary placeholder:text-text-muted transition-colors focus:border-accent-500/55 focus:outline-none disabled:opacity-50"
        />
        <Button
          type="submit"
          size="md"
          disabled={!value.trim() || streaming || !activeChannelId}
          className="h-11 w-11 px-0"
          leadingIcon={<AppIcon name="send" size={14} />}
        />
      </div>
    </form>
  );
}
