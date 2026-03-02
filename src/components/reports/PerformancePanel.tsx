import { useEffect } from "react";
import { useHrStore } from "../../stores/hrStore";
import { useReportStore } from "../../stores/reportStore";
import { EvaluationCard } from "./EvaluationCard";

export function PerformancePanel() {
  const { agents, fetchAgents } = useHrStore();
  const {
    evaluations,
    performanceSummaries,
    loading,
    fetchEvaluations,
    evaluateAgent,
    fetchPerformanceSummary,
  } = useReportStore();

  useEffect(() => {
    fetchAgents();
    fetchEvaluations();
  }, [fetchAgents, fetchEvaluations]);

  useEffect(() => {
    const activeAgents = agents.filter((a) => a.isActive);
    activeAgents.forEach((a) => fetchPerformanceSummary(a.id));
  }, [agents, fetchPerformanceSummary]);

  const activeAgents = agents.filter((a) => a.isActive);

  const scoreColor = (score: number) =>
    score >= 80
      ? "text-green-400"
      : score >= 50
        ? "text-yellow-400"
        : "text-red-400";

  const trendIcon = (trend: string) => {
    switch (trend) {
      case "up":
        return "↑";
      case "down":
        return "↓";
      default:
        return "→";
    }
  };

  const trendColor = (trend: string) => {
    switch (trend) {
      case "up":
        return "text-green-400";
      case "down":
        return "text-red-400";
      default:
        return "text-text-muted";
    }
  };

  const formatTime = (secs: number) => {
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}m`;
    return `${(secs / 3600).toFixed(1)}h`;
  };

  const handleEvaluate = async (agentId: string) => {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await evaluateAgent(agentId, period);
  };

  return (
    <div className="space-y-6">
      {/* Agent Performance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeAgents.map((agent) => {
          const summary = performanceSummaries.get(agent.id);
          return (
            <div
              key={agent.id}
              className="bg-surface-800 border border-white/[0.06] rounded-2xl p-4"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{agent.avatar || "🤖"}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary truncate">
                    {agent.name}
                  </h3>
                  <span className="text-[11px] text-text-muted">
                    {agent.role}
                  </span>
                </div>
                {summary && (
                  <div className="ml-auto flex items-center gap-1">
                    <span
                      className={`text-xl font-bold ${scoreColor(summary.score)}`}
                    >
                      {Math.round(summary.score)}
                    </span>
                    <span
                      className={`text-sm ${trendColor(summary.trend)}`}
                    >
                      {trendIcon(summary.trend)}
                    </span>
                  </div>
                )}
              </div>

              {summary ? (
                <div className="space-y-2 mb-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Success Rate</span>
                    <span className="text-text-secondary">
                      {summary.taskSuccessRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Avg Time</span>
                    <span className="text-text-secondary">
                      {formatTime(summary.avgTimeSecs)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Total Tasks</span>
                    <span className="text-text-secondary">
                      {summary.totalTasks}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Total Cost</span>
                    <span className="text-text-secondary">
                      ${summary.totalCost.toFixed(4)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-text-muted mb-3">
                  데이터 로딩 중...
                </div>
              )}

              <button
                onClick={() => handleEvaluate(agent.id)}
                disabled={loading}
                className="w-full px-3 py-1.5 bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? "평가 중..." : "평가하기"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Recent Evaluations */}
      {evaluations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            최근 평가 기록
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {evaluations.slice(0, 6).map((evaluation) => {
              const agent = agents.find((a) => a.id === evaluation.agentId);
              return (
                <EvaluationCard
                  key={evaluation.id}
                  evaluation={evaluation}
                  agentName={agent?.name}
                />
              );
            })}
          </div>
        </div>
      )}

      {activeAgents.length === 0 && (
        <div className="text-center py-12 text-text-muted text-sm">
          활성화된 에이전트가 없습니다.
        </div>
      )}
    </div>
  );
}
