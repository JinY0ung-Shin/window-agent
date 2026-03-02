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
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-surface-700/70 text-text-secondary">
        <AppIcon name={icon} size={18} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {description && <p className="text-xs text-text-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}
