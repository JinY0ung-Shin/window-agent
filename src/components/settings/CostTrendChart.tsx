import { useState } from "react";
import type { DailyCost } from "../../services/types";
import { AppIcon } from "../ui/AppIcon";

interface CostTrendChartProps {
  data: DailyCost[];
}

export function CostTrendChart({ data }: CostTrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-surface-800 p-5">
        <h3 className="mb-4 text-sm font-semibold text-text-primary">일별 비용 추이</h3>
        <div className="py-10 text-center">
          <span className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-surface-700/75 text-text-muted">
            <AppIcon name="trendDown" size={16} />
          </span>
          <p className="text-xs text-text-muted">비용 데이터가 없습니다</p>
        </div>
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.001);

  return (
    <div className="rounded-2xl border border-white/5 bg-surface-800 p-5">
      <h3 className="mb-4 text-sm font-semibold text-text-primary">일별 비용 추이</h3>
      <div className="relative flex h-40 items-end gap-1">
        {data.map((item, idx) => {
          const heightPct = (item.costUsd / maxCost) * 100;
          const dateLabel = item.date.slice(5);
          return (
            <div
              key={item.date}
              className="relative flex flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {hoveredIndex === idx && (
                <div className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-surface-700 px-2 py-1 text-xs text-text-primary shadow-lg">
                  <div className="font-medium">{item.date}</div>
                  <div className="text-accent-400">${item.costUsd.toFixed(4)}</div>
                  <div className="text-text-muted">{item.tokens.toLocaleString()} tokens</div>
                </div>
              )}
              <div
                className="min-h-[2px] w-full rounded-t transition-all duration-200"
                style={{
                  height: `${Math.max(heightPct, 1)}%`,
                  backgroundColor:
                    hoveredIndex === idx
                      ? "var(--color-accent-400)"
                      : "var(--color-accent-500)",
                  opacity: hoveredIndex === idx ? 1 : 0.7,
                }}
              />
              {data.length <= 14 && (
                <span className="mt-1 w-full truncate text-center text-[9px] text-text-muted">
                  {dateLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {data.length > 14 && (
        <div className="mt-1 flex justify-between">
          <span className="text-[9px] text-text-muted">{data[0]?.date.slice(5)}</span>
          <span className="text-[9px] text-text-muted">{data[data.length - 1]?.date.slice(5)}</span>
        </div>
      )}
    </div>
  );
}
