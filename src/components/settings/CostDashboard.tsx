import { useEffect, useState, useMemo } from "react";
import { useCostStore } from "../../stores/costStore";
import { CostTrendChart } from "./CostTrendChart";
import { AgentCostDetail } from "./AgentCostDetail";
import { AppIcon } from "../ui/AppIcon";

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
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <AppIcon name="money" size={15} className="text-accent-400" /> 비용 관리
        </h2>
        <div className="flex gap-1 rounded-lg bg-surface-700/50 p-0.5">
          {[
            { id: "week" as PeriodType, label: "이번 주" },
            { id: "month" as PeriodType, label: "이번 달" },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`rounded-md px-3 py-1 text-xs transition-all ${
                period === p.id
                  ? "bg-accent-500/15 font-medium text-accent-400"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/[0.06] bg-surface-800 p-4">
          <p className="mb-1 text-xs tracking-wide text-text-muted">총 비용</p>
          <p className="text-lg font-bold text-text-primary">
            ${loading ? "..." : (summary?.totalCost ?? 0).toFixed(4)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-surface-800 p-4">
          <p className="mb-1 text-xs tracking-wide text-text-muted">총 토큰</p>
          <p className="text-lg font-bold text-text-primary">
            {loading ? "..." : (summary?.totalTokens ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-surface-800 p-4">
          <p className="mb-1 text-xs tracking-wide text-text-muted">API 호출</p>
          <p className="text-lg font-bold text-text-primary">
            {loading
              ? "..."
              : (summary?.byAgent.reduce((sum, a) => sum + a.callCount, 0) ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      <CostTrendChart data={trend} />

      <div className="rounded-2xl border border-white/[0.06] bg-surface-800 p-5">
        <h3 className="mb-4 text-sm font-semibold text-text-primary">에이전트별 비용</h3>
        {!summary || summary.byAgent.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs text-text-muted">에이전트 비용 데이터가 없습니다</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-text-muted">
                <th className="py-2 pr-3 text-left font-medium">에이전트</th>
                <th className="py-2 pr-3 text-right font-medium">호출 수</th>
                <th className="py-2 pr-3 text-right font-medium">토큰</th>
                <th className="py-2 text-right font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {summary.byAgent.map((agent) => (
                <tr
                  key={agent.agentId}
                  className="cursor-pointer border-b border-white/[0.06] hover:bg-surface-700/50"
                  onClick={() => setSelectedAgentId(agent.agentId)}
                >
                  <td className="py-2 pr-3 font-medium text-text-primary">{agent.agentName}</td>
                  <td className="py-2 pr-3 text-right text-text-secondary">{agent.callCount}</td>
                  <td className="py-2 pr-3 text-right text-text-secondary">{agent.tokens.toLocaleString()}</td>
                  <td className="py-2 text-right font-medium text-accent-400">
                    ${agent.costUsd.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-surface-800 p-5">
        <h3 className="mb-4 text-sm font-semibold text-text-primary">모델별 비용 요약</h3>
        {!summary || summary.byModel.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs text-text-muted">모델 비용 데이터가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {summary.byModel.map((model) => {
              const pct = summary.totalCost > 0 ? (model.costUsd / summary.totalCost) * 100 : 0;
              return (
                <div key={model.model}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-mono text-text-primary">
                      {model.model.length > 30 ? model.model.slice(0, 30) + "..." : model.model}
                    </span>
                    <span className="text-xs font-medium text-accent-400">${model.costUsd.toFixed(4)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-700">
                    <div
                      className="h-full rounded-full bg-accent-500 transition-all duration-500"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    {model.tokens.toLocaleString()} tokens ({pct.toFixed(1)}%)
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
