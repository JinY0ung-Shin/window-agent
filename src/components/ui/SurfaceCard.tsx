import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md";
}

const paddingClasses = {
  none: "",
  sm: "p-4",
  md: "p-5",
} as const;

export function SurfaceCard({
  children,
  className,
  padding = "md",
}: SurfaceCardProps) {
  return (
    <section
      className={cn(
        "surface-card",
        paddingClasses[padding],
        className
      )}
    >
      {children}
    </section>
  );
}
