import { useEffect } from "react";
import { useHrStore } from "../../stores/hrStore";
import type { Agent, AgentStatus } from "../../services/types";

const agentEmoji: Record<string, string> = {
  "김비서": "👩‍💼",
  "박개발": "💻",
  "이분석": "📊",
  "최기획": "📝",
  "정조사": "🔍",
  "한디자": "🎨",
  "강관리": "📁",
  "윤자동": "🔧",
};

const statusConfig: Record<AgentStatus, { label: string; className: string }> = {
  online: { label: "온라인", className: "bg-success/10 text-success" },
  busy: { label: "작업중", className: "bg-warning/10 text-warning" },
  offline: { label: "오프라인", className: "bg-surface-600 text-text-muted" },
  error: { label: "오류", className: "bg-danger/10 text-danger" },
};

export function AgentTable() {
  const {
    agents,
    loading,
    fetchAgents,
    fetchDepartments,
    setSelectedAgent,
    openCreateModal,
    openEditModal,
    openFireModal,
    openProfileCard,
  } = useHrStore();

  useEffect(() => {
    fetchAgents();
    fetchDepartments();
  }, [fetchAgents, fetchDepartments]);

  if (loading) {
    return (
      <div className="bg-surface-800 border border-white/[0.06] rounded-2xl shadow-lg p-5">
        <div className="flex items-center justify-center py-12 text-text-muted text-sm">
          로딩 중...
        </div>
      </div>
    );
  }

  const handleRowClick = (agent: Agent) => {
    setSelectedAgent(agent);
    openProfileCard();
  };

  const handleEdit = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    setSelectedAgent(agent);
    openEditModal();
  };

  const handleFire = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    setSelectedAgent(agent);
    openFireModal();
  };

  return (
    <div className="bg-surface-800 border border-white/[0.06] rounded-2xl shadow-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          에이전트 목록
        </h2>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 새 에이전트 채용
        </button>
      </div>

      <div className="bg-surface-700/40 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                에이전트
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                역할
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                부서
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                상태
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                AI 백엔드
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                액션
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => {
              const status = statusConfig[agent.status];
              const emoji = agentEmoji[agent.name] || agent.avatar || "🤖";
              const inactive = !agent.isActive;

              return (
                <tr
                  key={agent.id}
                  onClick={() => handleRowClick(agent)}
                  className={`border-b border-white/[0.04] hover:bg-surface-700/30 cursor-pointer transition-colors ${
                    inactive ? "opacity-50" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-sm text-text-primary">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{emoji}</span>
                      <span className={inactive ? "line-through" : ""}>
                        {agent.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {agent.role}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {agent.department}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {agent.aiBackend}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleEdit(e, agent)}
                        className="px-3 py-1 bg-surface-700 hover:bg-surface-600 text-text-primary text-xs rounded-lg transition-colors"
                      >
                        수정
                      </button>
                      {agent.isActive && (
                        <button
                          onClick={(e) => handleFire(e, agent)}
                          className="px-3 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs rounded-lg transition-colors"
                        >
                          해고
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {agents.length === 0 && (
          <div className="text-center py-8 text-text-muted text-sm">
            등록된 에이전트가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
