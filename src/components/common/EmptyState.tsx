import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  message: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, message, hint, action, className }: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ""}`}>
      {icon}
      <p>{message}</p>
      {hint && <p className="text-muted">{hint}</p>}
      {action}
    </div>
  );
}
