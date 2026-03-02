import type { Evaluation } from "../../services/types";

interface EvaluationCardProps {
  evaluation: Evaluation;
  agentName?: string;
}

export function EvaluationCard({ evaluation, agentName }: EvaluationCardProps) {
  const scoreColor =
    evaluation.score >= 80
      ? "text-green-400"
      : evaluation.score >= 50
        ? "text-yellow-400"
        : "text-red-400";

  const barColor =
    evaluation.score >= 80
      ? "bg-green-500"
      : evaluation.score >= 50
        ? "bg-yellow-500"
        : "bg-red-500";

  const formatTime = (secs: number) => {
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}m`;
    return `${(secs / 3600).toFixed(1)}h`;
  };

  return (
    <div className="bg-surface-800 border border-white/[0.06] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          {agentName && (
            <span className="text-xs text-text-muted">{agentName}</span>
          )}
          <span className="text-xs text-text-muted ml-2">
            {evaluation.period}
          </span>
        </div>
        <span className={`text-2xl font-bold ${scoreColor}`}>
          {Math.round(evaluation.score)}
        </span>
      </div>

      <div className="w-full bg-surface-700 rounded-full h-2 mb-3">
        <div
          className={`h-2 rounded-full ${barColor} transition-all`}
          style={{ width: `${Math.min(evaluation.score, 100)}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Success Rate</span>
          <span className="text-text-secondary">
            {evaluation.taskSuccessRate.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Avg Time</span>
          <span className="text-text-secondary">
            {formatTime(evaluation.avgCompletionTimeSecs)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Tasks</span>
          <span className="text-text-secondary">
            {evaluation.completedTasks}/{evaluation.totalTasks}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Cost</span>
          <span className="text-text-secondary">
            ${evaluation.totalCostUsd.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}
