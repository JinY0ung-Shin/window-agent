import { getAvatarLabel } from "../../lib/avatar";
import { cn } from "../../lib/utils";

interface AvatarBadgeProps {
  name: string;
  avatar?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

export function AvatarBadge({
  name,
  avatar,
  className,
  size = "md",
}: AvatarBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-surface-600 to-surface-700 font-semibold text-text-primary",
        sizeClasses[size],
        className
      )}
      aria-hidden="true"
    >
      {getAvatarLabel(name, avatar)}
    </div>
  );
}
