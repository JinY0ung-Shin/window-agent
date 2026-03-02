import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md";
}

const paddingClasses = {
  none: "",
  sm: "p-5 sm:p-6",
  md: "p-6 sm:p-8",
} as const;

export function SurfaceCard({
  children,
  className,
  padding = "md",
}: SurfaceCardProps) {
  return (
    <section
      className={cn(
        "surface-card animate-slideUp",
        paddingClasses[padding],
        className
      )}
    >
      {children}
    </section>
  );
}
