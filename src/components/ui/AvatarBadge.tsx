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
        "inline-flex items-center justify-center rounded-full border border-white/[0.08] bg-gradient-to-br from-accent-500/30 via-cyan-500/20 to-surface-700 font-semibold text-text-primary shadow-[0_0_8px_rgba(124,58,237,0.12)] transition-all duration-200",
        sizeClasses[size],
        className
      )}
      aria-hidden="true"
    >
      {getAvatarLabel(name, avatar)}
    </div>
  );
}
