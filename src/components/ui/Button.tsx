import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-accent-500 to-accent-600 text-white hover:shadow-[0_0_20px_rgba(124,58,237,0.35)] hover:brightness-110 active:scale-[0.97]",
  secondary:
    "border border-white/[0.08] bg-surface-700/50 text-text-primary backdrop-blur-sm hover:bg-surface-600/60 hover:border-accent-500/20 active:scale-[0.97]",
  ghost:
    "bg-transparent text-text-secondary hover:bg-white/[0.05] hover:text-text-primary active:scale-[0.97]",
  danger:
    "border border-danger/25 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger/40 hover:shadow-[0_0_16px_rgba(248,113,113,0.15)] active:scale-[0.97]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  block,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/50 disabled:pointer-events-none disabled:opacity-40",
        variantClasses[variant],
        sizeClasses[size],
        block && "w-full",
        className
      )}
      {...props}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
