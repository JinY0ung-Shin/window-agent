import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col bg-surface-900">
      <Header />
      <div className="min-h-0 flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="relative flex-1 overflow-auto">
          <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(circle_at_20%_0%,rgba(37,99,235,0.09),transparent_36%),radial-gradient(circle_at_90%_0%,rgba(37,99,235,0.06),transparent_30%)]" />
          <div className="relative z-10 min-h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
