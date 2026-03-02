import { useEffect } from "react";
import { useCostStore } from "../../stores/costStore";

interface AgentCostDetailProps {
  agentId: string;
  agentName: string;
  totalCost: number;
  onClose: () => void;
}

export function AgentCostDetail({ agentId, agentName, totalCost, onClose }: AgentCostDetailProps) {
  const { agentHistory, fetchAgentCostHistory } = useCostStore();

  useEffect(() => {
    fetchAgentCostHistory(agentId, 50);
  }, [agentId, fetchAgentCostHistory]);

  return (
    <div className="bg-surface-800 border border-white/5 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {agentName} 비용 이력
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            총 비용: <span className="text-accent-400">${totalCost.toFixed(4)}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded-lg hover:bg-surface-700 transition-colors"
        >
          닫기
        </button>
      </div>

      {agentHistory.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-text-muted">비용 이력이 없습니다</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted border-b border-white/5">
                <th className="text-left py-2 pr-3 font-medium">시간</th>
                <th className="text-left py-2 pr-3 font-medium">모델</th>
                <th className="text-right py-2 pr-3 font-medium">입력 토큰</th>
                <th className="text-right py-2 pr-3 font-medium">출력 토큰</th>
                <th className="text-right py-2 font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {agentHistory.map((record) => (
                <tr key={record.id} className="border-b border-white/5 hover:bg-surface-700/50">
                  <td className="py-2 pr-3 text-text-secondary">
                    {new Date(record.timestamp).toLocaleString("ko-KR", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2 pr-3 text-text-primary font-mono text-[10px]">
                    {record.model.length > 20 ? record.model.slice(0, 20) + "..." : record.model}
                  </td>
                  <td className="py-2 pr-3 text-right text-text-secondary">
                    {record.tokensInput.toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-right text-text-secondary">
                    {record.tokensOutput.toLocaleString()}
                  </td>
                  <td className="py-2 text-right text-accent-400 font-medium">
                    ${record.costUsd.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
