import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { AppIcon, type AppIconName } from "./AppIcon";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: AppIconName;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon = "empty",
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("empty-state", className)}>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.06] bg-gradient-to-br from-accent-500/15 to-surface-700/70 text-text-secondary shadow-[0_0_16px_rgba(124,58,237,0.08)]">
        <AppIcon name={icon} size={20} />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {description && <p className="text-xs text-text-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}
