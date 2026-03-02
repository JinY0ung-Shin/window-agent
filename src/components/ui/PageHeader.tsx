import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { AppIcon, type AppIconName } from "./AppIcon";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: AppIconName;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("page-header", className)}>
      <div className="space-y-1">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold text-text-primary sm:text-xl">
          {icon && (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-surface-700/70 text-accent-400">
              <AppIcon name={icon} size={16} />
            </span>
          )}
          {title}
        </h1>
        {description && <p className="text-sm text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
