import { useUiStore, type Page } from "../../stores/uiStore";
import { cn } from "../../lib/utils";

const navItems: { id: Page; label: string; emoji: string }[] = [
  { id: "dashboard", label: "대시보드", emoji: "📊" },
  { id: "chat", label: "채팅", emoji: "💬" },
  { id: "hr", label: "인사관리", emoji: "👤" },
  { id: "tasks", label: "업무보드", emoji: "📋" },
  { id: "reports", label: "보고서", emoji: "📄" },
  { id: "orgchart", label: "조직도", emoji: "🏛️" },
  { id: "settings", label: "설정", emoji: "⚙️" },
];

export function Sidebar() {
  const { activePage, setActivePage, sidebarCollapsed } = useUiStore();

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-surface-700 bg-surface-800 transition-all duration-200",
        sidebarCollapsed ? "w-16" : "w-56"
      )}
    >
      {/* Branding */}
      {!sidebarCollapsed && (
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">🏢</span>
            <span className="text-xs font-bold text-text-primary">Window Agent Inc.</span>
          </div>
          <p className="text-[10px] text-text-muted pl-6">AI 비서 관리 시스템</p>
        </div>
      )}

      {/* Menu Label */}
      {!sidebarCollapsed && (
        <div className="px-4 pt-3 pb-1">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">메뉴</span>
        </div>
      )}

      <nav className="flex-1 py-2 px-2 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70",
              activePage === item.id
                ? "bg-accent-500/15 text-accent-400 font-medium"
                : "text-text-secondary hover:bg-surface-700 hover:text-text-primary"
            )}
          >
            {activePage === item.id && (
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-5 bg-accent-500 rounded-r-full" />
            )}
            <span className="text-base">{item.emoji}</span>
            {!sidebarCollapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Profile Card */}
      <div className="p-3 border-t border-surface-700">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl p-2 bg-surface-700/40",
            sidebarCollapsed && "justify-center p-2"
          )}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-500/30 to-accent-400/10 flex items-center justify-center text-sm shrink-0">
            👩‍💼
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-primary truncate">김비서</p>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-success" />
                <p className="text-[10px] text-success">온라인</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
