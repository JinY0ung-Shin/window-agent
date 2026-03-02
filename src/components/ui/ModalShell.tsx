import { useEffect } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { AppIcon } from "./AppIcon";

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  bodyClassName?: string;
  showClose?: boolean;
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function ModalShell({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
  bodyClassName,
  showClose = true,
}: ModalShellProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border border-white/10 bg-surface-800 shadow-[0_32px_64px_rgba(0,0,0,0.45)]",
          sizeClasses[size],
          className
        )}
      >
        {(title || description || showClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
            <div className="space-y-1">
              {title && <h2 className="text-base font-semibold text-text-primary">{title}</h2>}
              {description && <p className="text-sm text-text-secondary">{description}</p>}
            </div>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary"
                aria-label="닫기"
              >
                <AppIcon name="close" size={16} />
              </button>
            )}
          </div>
        )}

        <div className={cn("max-h-[75vh] overflow-auto px-5 py-4", bodyClassName)}>{children}</div>

        {footer && <div className="border-t border-white/[0.08] px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
