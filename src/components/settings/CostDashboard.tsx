import { useEffect, useState, useMemo } from "react";
import { useCostStore } from "../../stores/costStore";
import { CostTrendChart } from "./CostTrendChart";
import { AgentCostDetail } from "./AgentCostDetail";

type PeriodType = "week" | "month" | "custom";

export function CostDashboard() {
  const { summary, trend, loading, fetchCostSummary, fetchCostTrend } = useCostStore();
  const [period, setPeriod] = useState<PeriodType>("month");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const periodDates = useMemo(() => {
    const now = new Date();
    if (period === "week") {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { start: start.toISOString(), end: now.toISOString() };
    }
    if (period === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: start.toISOString(), end: now.toISOString() };
    }
    return { start: undefined, end: undefined };
  }, [period]);

  useEffect(() => {
    fetchCostSummary(periodDates.start, periodDates.end);
    fetchCostTrend(period === "week" ? 7 : 30);
  }, [periodDates, period, fetchCostSummary, fetchCostTrend]);

  const selectedAgent = summary?.byAgent.find((a) => a.agentId === selectedAgentId);

  return (
    <div className="space-y-5">
      {/* Header + Period Selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>💰</span> 비용 관리
        </h2>
        <div className="flex gap-1 bg-surface-700/50 rounded-lg p-0.5">
          {([
            { id: "week" as PeriodType, label: "이번 주" },
            { id: "month" as PeriodType, label: "이번 달" },
          ]).map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1 rounded-md text-xs transition-all ${
                period === p.id
                  ? "bg-accent-500/15 text-accent-400 font-medium"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface-800 border border-white/[0.06] rounded-2xl p-4">
          <p className="text-xs text-text-muted tracking-wide mb-1">총 비용</p>
          <p className="text-lg font-bold text-text-primary">
            ${loading ? "..." : (summary?.totalCost ?? 0).toFixed(4)}
          </p>
        </div>
        <div className="bg-surface-800 border border-white/[0.06] rounded-2xl p-4">
          <p className="text-xs text-text-muted tracking-wide mb-1">총 토큰</p>
          <p className="text-lg font-bold text-text-primary">
            {loading ? "..." : (summary?.totalTokens ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-800 border border-white/[0.06] rounded-2xl p-4">
          <p className="text-xs text-text-muted tracking-wide mb-1">API 호출</p>
          <p className="text-lg font-bold text-text-primary">
            {loading
              ? "..."
              : (summary?.byAgent.reduce((sum, a) => sum + a.callCount, 0) ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Trend Chart */}
      <CostTrendChart data={trend} />

      {/* Agent Cost Table */}
      <div className="bg-surface-800 border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          에이전트별 비용
        </h3>
        {!summary || summary.byAgent.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs text-text-muted">에이전트 비용 데이터가 없습니다</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted border-b border-white/[0.06]">
                <th className="text-left py-2 pr-3 font-medium">에이전트</th>
                <th className="text-right py-2 pr-3 font-medium">호출 수</th>
                <th className="text-right py-2 pr-3 font-medium">토큰</th>
                <th className="text-right py-2 font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {summary.byAgent.map((agent) => (
                <tr
                  key={agent.agentId}
                  className="border-b border-white/[0.06] hover:bg-surface-700/50 cursor-pointer"
                  onClick={() => setSelectedAgentId(agent.agentId)}
                >
                  <td className="py-2 pr-3 text-text-primary font-medium">{agent.agentName}</td>
                  <td className="py-2 pr-3 text-right text-text-secondary">{agent.callCount}</td>
                  <td className="py-2 pr-3 text-right text-text-secondary">
                    {agent.tokens.toLocaleString()}
                  </td>
                  <td className="py-2 text-right text-accent-400 font-medium">
                    ${agent.costUsd.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Model Cost Summary */}
      <div className="bg-surface-800 border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          모델별 비용 요약
        </h3>
        {!summary || summary.byModel.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs text-text-muted">모델 비용 데이터가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {summary.byModel.map((model) => {
              const pct = summary.totalCost > 0 ? (model.costUsd / summary.totalCost) * 100 : 0;
              return (
                <div key={model.model}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-primary font-mono">
                      {model.model.length > 30 ? model.model.slice(0, 30) + "..." : model.model}
                    </span>
                    <span className="text-xs text-accent-400 font-medium">
                      ${model.costUsd.toFixed(4)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {model.tokens.toLocaleString()} tokens ({pct.toFixed(1)}%)
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Agent Cost Detail (expanded) */}
      {selectedAgent && selectedAgentId && (
        <AgentCostDetail
          agentId={selectedAgentId}
          agentName={selectedAgent.agentName}
          totalCost={selectedAgent.costUsd}
          onClose={() => setSelectedAgentId(null)}
        />
      )}
    </div>
  );
}
