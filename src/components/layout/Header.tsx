import { useUiStore } from "../../stores/uiStore";
import { AvatarBadge } from "../ui/AvatarBadge";
import { AppIcon } from "../ui/AppIcon";

export function Header() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <header className="h-14 border-b border-white/[0.08] bg-surface-800/88 px-4 backdrop-blur-md lg:px-5">
      <div className="flex h-full items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSidebar}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-700 hover:text-text-primary"
            aria-label="사이드바 토글"
          >
            <AppIcon name="menu" size={16} />
          </button>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent-500/18 text-accent-400">
            <AppIcon name="building" size={16} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-primary">Window Agent</h1>
            <p className="text-[11px] text-text-muted">AI Company Management</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-700 hover:text-text-primary"
            aria-label="알림"
          >
            <AppIcon name="bell" size={16} />
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent-400" />
          </button>

          <div className="flex items-center gap-2 border-l border-white/[0.08] pl-2.5">
            <AvatarBadge name="대표" size="md" className="from-accent-500/40 to-surface-700" />
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-text-primary">대표님</p>
              <p className="text-[11px] text-success">온라인</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
