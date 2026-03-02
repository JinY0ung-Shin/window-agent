import { useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";
import { AppIcon } from "../ui/AppIcon";
import { Button } from "../ui/Button";
import { SurfaceCard } from "../ui/SurfaceCard";

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
    <SurfaceCard>
      <h2 className="section-title">
        <AppIcon name="command" size={15} className="text-accent-400" />
        <span>빠른 지시</span>
      </h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <AppIcon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="김비서에게 지시하기..."
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-surface-900/85 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-accent-500/55 focus:outline-none"
          />
        </div>
        <Button
          type="submit"
          disabled={!value.trim()}
          leadingIcon={<AppIcon name="send" size={14} />}
        >
          전송
        </Button>
      </form>
    </SurfaceCard>
  );
}
