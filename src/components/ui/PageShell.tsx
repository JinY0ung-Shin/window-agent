import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface PageShellProps {
  children: ReactNode;
  className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
  return <div className={cn("app-page", className)}>{children}</div>;
}
