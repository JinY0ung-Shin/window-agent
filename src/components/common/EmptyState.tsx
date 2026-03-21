import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  message: string;
  hint?: string;
  className?: string;
}

export default function EmptyState({ icon, message, hint, className }: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ""}`}>
      {icon}
      <p>{message}</p>
      {hint && <p className="text-muted">{hint}</p>}
    </div>
  );
}
