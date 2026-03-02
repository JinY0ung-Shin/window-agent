import { useState } from "react";
import type { DailyCost } from "../../services/types";

interface CostTrendChartProps {
  data: DailyCost[];
}

export function CostTrendChart({ data }: CostTrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="bg-surface-800 border border-white/5 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          일별 비용 추이
        </h3>
        <div className="text-center py-10">
          <div className="text-2xl mb-2">📉</div>
          <p className="text-xs text-text-muted">비용 데이터가 없습니다</p>
        </div>
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.001);

  return (
    <div className="bg-surface-800 border border-white/5 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">
        일별 비용 추이
      </h3>
      <div className="flex items-end gap-1 h-40 relative">
        {data.map((item, idx) => {
          const heightPct = (item.costUsd / maxCost) * 100;
          const dateLabel = item.date.slice(5); // MM-DD
          return (
            <div
              key={item.date}
              className="flex-1 flex flex-col items-center justify-end relative"
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {hoveredIndex === idx && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-surface-700 border border-white/10 rounded-lg px-2 py-1 text-xs text-text-primary whitespace-nowrap z-10 shadow-lg">
                  <div className="font-medium">{item.date}</div>
                  <div className="text-accent-400">${item.costUsd.toFixed(4)}</div>
                  <div className="text-text-muted">{item.tokens.toLocaleString()} tokens</div>
                </div>
              )}
              <div
                className="w-full rounded-t transition-all duration-200 min-h-[2px]"
                style={{
                  height: `${Math.max(heightPct, 1)}%`,
                  backgroundColor: hoveredIndex === idx ? "rgb(96, 165, 250)" : "rgb(59, 130, 246)",
                  opacity: hoveredIndex === idx ? 1 : 0.7,
                }}
              />
              {data.length <= 14 && (
                <span className="text-[9px] text-text-muted mt-1 truncate w-full text-center">
                  {dateLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {data.length > 14 && (
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-text-muted">{data[0]?.date.slice(5)}</span>
          <span className="text-[9px] text-text-muted">{data[data.length - 1]?.date.slice(5)}</span>
        </div>
      )}
    </div>
  );
}
