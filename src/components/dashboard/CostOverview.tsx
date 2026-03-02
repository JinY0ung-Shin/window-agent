import { useEffect } from "react";
import { useCostStore } from "../../stores/costStore";
import { AppIcon } from "../ui/AppIcon";
import { EmptyState } from "../ui/EmptyState";
import { SurfaceCard } from "../ui/SurfaceCard";

export function CostOverview() {
  const { summary, loading, fetchCostSummary } = useCostStore();

  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    fetchCostSummary(start.toISOString(), now.toISOString());
  }, [fetchCostSummary]);

  const totalCalls = summary?.byAgent.reduce((sum, a) => sum + a.callCount, 0) ?? 0;
  const topAgents = (summary?.byAgent ?? []).slice(0, 3);
  const maxAgentCost =
    topAgents.length > 0 ? Math.max(...topAgents.map((a) => a.costUsd), 0.001) : 1;

  return (
    <SurfaceCard>
      <h2 className="section-title">
        <AppIcon name="money" size={15} className="text-accent-400" />
        <span>이번 달 비용</span>
      </h2>

      {loading ? (
        <div className="py-6 text-center">
          <p className="text-sm text-text-muted">로딩 중...</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/[0.08] bg-surface-700/55 p-3">
              <p className="mb-0.5 text-xs text-text-muted">총 비용</p>
              <p className="text-xl font-semibold text-text-primary">
                ${(summary?.totalCost ?? 0).toFixed(4)}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-surface-700/55 p-3">
              <p className="mb-0.5 text-xs text-text-muted">API 호출</p>
              <p className="text-xl font-semibold text-text-primary">{totalCalls.toLocaleString()}회</p>
            </div>
          </div>

          {topAgents.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-text-muted">상위 에이전트</p>
              {topAgents.map((agent) => {
                const widthPct = (agent.costUsd / maxAgentCost) * 100;
                return (
                  <div key={agent.agentId} className="flex items-center gap-2">
                    <span
                      className="w-20 truncate text-xs text-text-secondary"
                      title={agent.agentName}
                    >
                      {agent.agentName}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-700">
                      <div
                        className="h-full rounded-full bg-accent-500/75"
                        style={{ width: `${Math.max(widthPct, 2)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right text-[11px] font-medium text-accent-400">
                      ${agent.costUsd.toFixed(3)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="money"
              title="비용 데이터가 없습니다"
              className="py-6"
            />
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
