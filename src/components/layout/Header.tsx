import { useUiStore } from "../../stores/uiStore";
import { AvatarBadge } from "../ui/AvatarBadge";
import { AppIcon } from "../ui/AppIcon";

export function Header() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <header className="relative h-14 border-b border-white/[0.06] bg-surface-800/60 px-4 backdrop-blur-xl lg:px-5">
      {/* Bottom gradient border line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-500/25 to-transparent" />

      <div className="flex h-full items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleSidebar}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-text-secondary transition-all duration-200 hover:bg-white/[0.06] hover:text-text-primary hover:scale-105"
            aria-label="사이드바 토글"
          >
            <AppIcon name="menu" size={16} />
          </button>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500/25 to-cyan-500/15 text-accent-400 shadow-[0_0_12px_rgba(124,58,237,0.15)]">
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
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl text-text-secondary transition-all duration-200 hover:bg-white/[0.06] hover:text-text-primary hover:scale-105"
            aria-label="알림"
          >
            <AppIcon name="bell" size={16} />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-400 shadow-[0_0_6px_rgba(167,139,250,0.6)]" />
          </button>

          <div className="flex items-center gap-2.5 border-l border-white/[0.06] pl-2.5">
            <AvatarBadge name="대표" size="md" />
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
