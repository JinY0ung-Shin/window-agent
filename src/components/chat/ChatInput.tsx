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
      className="border-t border-white/[0.06] bg-surface-800/50 p-5 backdrop-blur-xl"
    >
      <div className="flex items-end gap-2.5">
        <textarea
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!activeChannelId || streaming}
          placeholder={activeChannelId ? "메시지를 입력하세요..." : "채널을 선택하세요"}
          className="min-h-[50px] max-h-[150px] flex-1 resize-none overflow-y-auto rounded-xl border border-white/[0.06] bg-surface-900/50 px-4 py-3 text-sm leading-relaxed text-text-primary placeholder:text-text-muted backdrop-blur-sm transition-all duration-200 focus:border-accent-500/40 focus:shadow-[0_0_16px_rgba(124,58,237,0.1)] focus:outline-none disabled:opacity-40"
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
