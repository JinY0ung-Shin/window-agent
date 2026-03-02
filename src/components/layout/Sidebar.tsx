import { useUiStore, type Page } from "../../stores/uiStore";
import { cn } from "../../lib/utils";
import { AppIcon, type AppIconName } from "../ui/AppIcon";
import { AvatarBadge } from "../ui/AvatarBadge";

const navItems: { id: Page; label: string; icon: AppIconName }[] = [
  { id: "dashboard", label: "대시보드", icon: "dashboard" },
  { id: "chat", label: "채팅", icon: "chat" },
  { id: "hr", label: "인사관리", icon: "users" },
  { id: "tasks", label: "업무보드", icon: "tasks" },
  { id: "reports", label: "보고서", icon: "reports" },
  { id: "orgchart", label: "조직도", icon: "orgchart" },
  { id: "settings", label: "설정", icon: "settings" },
];

export function Sidebar() {
  const { activePage, setActivePage, sidebarCollapsed } = useUiStore();

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-white/[0.08] bg-surface-800/92 transition-all duration-200",
        sidebarCollapsed ? "w-[78px]" : "w-[272px]"
      )}
    >
      {!sidebarCollapsed && (
        <div className="px-5 pb-4 pt-5">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-surface-700/80 text-accent-400">
              <AppIcon name="building" size={15} />
            </span>
            <span className="text-sm font-semibold text-text-primary">Window Agent Inc.</span>
          </div>
          <p className="pl-10 text-xs text-text-muted">운영 콘솔</p>
        </div>
      )}

      {!sidebarCollapsed && (
        <div className="px-5 pb-3 pt-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Menu</span>
        </div>
      )}

      <nav className="flex-1 space-y-2 px-3 pb-4">
        {navItems.map((item) => {
          const active = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={cn(
                "relative flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70",
                active
                  ? "bg-accent-500/16 text-text-primary"
                  : "text-text-secondary hover:bg-surface-700/75 hover:text-text-primary",
                sidebarCollapsed && "justify-center px-0"
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent-400" />}
              <AppIcon
                name={item.icon}
                size={16}
                className={active ? "text-accent-400" : "text-current"}
              />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.08] p-4">
        <div className={cn("flex items-center gap-3 rounded-xl border border-white/[0.08] bg-surface-700/45 p-3", sidebarCollapsed && "justify-center")}>
          <AvatarBadge name="김비서" size="sm" />
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">김비서</p>
              <p className="text-xs text-success">온라인</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
