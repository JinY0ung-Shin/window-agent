import { useUiStore, type Page } from "../../stores/uiStore";
import { cn } from "../../lib/utils";

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "대시보드", icon: "grid" },
  { id: "chat", label: "채팅", icon: "chat" },
];

function NavIcon({ icon }: { icon: string }) {
  if (icon === "grid") {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

export function Sidebar() {
  const { activePage, setActivePage, sidebarCollapsed } = useUiStore();

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-surface-700 bg-surface-800 transition-all duration-200",
        sidebarCollapsed ? "w-14" : "w-48"
      )}
    >
      <nav className="flex-1 py-3 px-2 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              activePage === item.id
                ? "bg-accent-500/15 text-accent-400"
                : "text-text-secondary hover:bg-surface-600 hover:text-text-primary"
            )}
          >
            <NavIcon icon={item.icon} />
            {!sidebarCollapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-surface-700">
        <div className={cn("flex items-center gap-2", sidebarCollapsed && "justify-center")}>
          <div className="w-7 h-7 rounded-full bg-accent-500/20 flex items-center justify-center text-xs text-accent-400 font-medium shrink-0">
            김
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-xs font-medium text-text-primary truncate">김비서</p>
              <p className="text-[10px] text-success">온라인</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
