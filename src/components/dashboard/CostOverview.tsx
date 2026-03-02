import { useEffect } from "react";
import { useCostStore } from "../../stores/costStore";

export function CostOverview() {
  const { summary, loading, fetchCostSummary } = useCostStore();

  useEffect(() => {
    // Fetch current month's summary
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    fetchCostSummary(start.toISOString(), now.toISOString());
  }, [fetchCostSummary]);

  const totalCalls = summary?.byAgent.reduce((sum, a) => sum + a.callCount, 0) ?? 0;
  const topAgents = (summary?.byAgent ?? []).slice(0, 3);
  const maxAgentCost = topAgents.length > 0 ? Math.max(...topAgents.map((a) => a.costUsd), 0.001) : 1;

  return (
    <div className="card">
      <h2 className="section-title">
        <span>💰</span>
        <span>이번 달 비용</span>
      </h2>

      {loading ? (
        <div className="text-center py-6">
          <p className="text-xs text-text-muted">로딩 중...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-700/50 rounded-xl p-3">
              <p className="text-xs text-text-muted tracking-wider mb-0.5">총 비용</p>
              <p className="text-xl font-bold text-text-primary">
                ${(summary?.totalCost ?? 0).toFixed(4)}
              </p>
            </div>
            <div className="bg-surface-700/50 rounded-xl p-3">
              <p className="text-xs text-text-muted tracking-wider mb-0.5">API 호출</p>
              <p className="text-xl font-bold text-text-primary">
                {totalCalls.toLocaleString()}회
              </p>
            </div>
          </div>

          {/* Top 3 agents mini bar */}
          {topAgents.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-text-muted tracking-wider">상위 에이전트</p>
              {topAgents.map((agent) => {
                const widthPct = (agent.costUsd / maxAgentCost) * 100;
                return (
                  <div key={agent.agentId} className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary w-20 truncate" title={agent.agentName}>{agent.agentName}</span>
                    <div className="flex-1 h-2 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-500/70 rounded-full"
                        style={{ width: `${Math.max(widthPct, 2)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-accent-400 font-medium w-14 text-right">
                      ${agent.costUsd.toFixed(3)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="text-2xl mb-2">💰</div>
              <p className="text-xs text-text-muted">비용 데이터 없음</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
