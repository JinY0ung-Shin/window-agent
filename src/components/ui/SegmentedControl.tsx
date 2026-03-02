import { cn } from "../../lib/utils";
import { AppIcon, type AppIconName } from "./AppIcon";

interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  icon?: AppIconName;
}

interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex rounded-xl border border-white/[0.06] bg-surface-700/40 p-1 backdrop-blur-sm",
        className
      )}
      role="tablist"
      aria-label="뷰 선택"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70",
              active
                ? "bg-gradient-to-r from-accent-500/20 to-cyan-500/10 text-text-primary shadow-[0_0_10px_rgba(124,58,237,0.1)]"
                : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
            )}
          >
            {item.icon && <AppIcon name={item.icon} size={14} />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
