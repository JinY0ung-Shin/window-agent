export function Header() {
  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-surface-700 bg-surface-800/80 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent-500 flex items-center justify-center text-white font-bold text-sm shadow-md">
          W
        </div>
        <div>
          <h1 className="text-sm font-bold text-text-primary tracking-tight">
            Window Agent
          </h1>
          <span className="text-[10px] text-text-muted">AI Company Management</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="relative w-8 h-8 rounded-lg bg-surface-700 hover:bg-surface-600 flex items-center justify-center transition-colors">
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-accent-500 rounded-full" />
        </button>
        <div className="flex items-center gap-2 pl-3 border-l border-surface-700">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center text-white text-xs font-bold shadow-md">
            👤
          </div>
          <div>
            <p className="text-xs font-medium text-text-primary">대표님</p>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-[10px] text-success">온라인</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
