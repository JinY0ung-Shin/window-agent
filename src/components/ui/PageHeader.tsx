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
    <div className={cn("page-header animate-fadeIn", className)}>
      <div className="space-y-1.5">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold text-text-primary sm:text-xl">
          {icon && (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500/20 to-cyan-500/10 text-accent-400 shadow-[0_0_14px_rgba(124,58,237,0.12)]">
              <AppIcon name={icon} size={17} />
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
