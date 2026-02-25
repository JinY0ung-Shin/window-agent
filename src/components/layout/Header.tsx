export function Header() {
  return (
    <header className="h-12 flex items-center justify-between px-5 border-b border-surface-700 bg-surface-800">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-text-primary tracking-tight">
          Window Agent
        </h1>
        <span className="text-xs text-text-muted">|</span>
        <span className="text-xs text-text-secondary">AI 비서 관리 시스템</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-success" />
        <span className="text-xs text-text-secondary">대표님</span>
      </div>
    </header>
  );
}
