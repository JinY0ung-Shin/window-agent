import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col bg-surface-900">
      <Header />
      <div className="min-h-0 flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="relative flex-1 overflow-auto">
          <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(ellipse_70%_50%_at_30%_-10%,rgba(124,58,237,0.08),transparent),radial-gradient(ellipse_50%_40%_at_85%_5%,rgba(6,182,212,0.06),transparent)]" />
          <div className="relative z-10 min-h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
