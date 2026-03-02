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
        "inline-flex rounded-xl border border-white/[0.08] bg-surface-700/70 p-1",
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
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70",
              active
                ? "bg-surface-600 text-text-primary"
                : "text-text-secondary hover:text-text-primary"
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
