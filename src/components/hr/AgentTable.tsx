import { useEffect } from "react";
import { useHrStore } from "../../stores/hrStore";
import type { Agent, AgentStatus } from "../../services/types";
import { AvatarBadge } from "../ui/AvatarBadge";
import { Button } from "../ui/Button";
import { AppIcon } from "../ui/AppIcon";

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
    openLeaveModal,
    restoreFromLeave,
    openBackupListModal,
  } = useHrStore();

  useEffect(() => {
    fetchAgents();
    fetchDepartments();
  }, [fetchAgents, fetchDepartments]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-surface-800/86 p-5 shadow-[0_18px_34px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-center py-12 text-sm text-text-muted">로딩 중...</div>
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

  const handleLeave = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    openLeaveModal(agent);
  };

  const handleRestore = async (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    await restoreFromLeave(agent.id);
  };

  const handleBackupList = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    openBackupListModal(agent);
  };

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-surface-800/86 p-4 shadow-[0_18px_34px_rgba(0,0,0,0.25)]">
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-surface-700/35">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                  에이전트
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                  역할
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                  부서
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                  상태
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                  AI 백엔드
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                  액션
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const status = statusConfig[agent.status];
                const inactive = !agent.isActive;

                return (
                  <tr
                    key={agent.id}
                    onClick={() => handleRowClick(agent)}
                    className={`cursor-pointer border-b border-white/[0.08] transition-colors hover:bg-white/[0.05] ${
                      inactive ? "opacity-55" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-sm text-text-primary">
                      <div className="flex items-center gap-2">
                        <AvatarBadge name={agent.name} avatar={agent.avatar} size="sm" />
                        <span className={inactive ? "line-through" : ""}>{agent.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">{agent.role}</td>
                    <td className="px-4 py-3 text-sm text-text-primary">{agent.department}</td>
                    <td className="px-4 py-3 text-sm">
                      {!agent.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-surface-600 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                          해고됨
                        </span>
                      ) : agent.onLeave ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] font-medium text-yellow-400">
                          휴직중
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm capitalize text-text-primary">{agent.aiBackend}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={(e) => handleEdit(e, agent)}>
                          수정
                        </Button>
                        {agent.isActive && !agent.onLeave && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-yellow-300 hover:bg-yellow-500/15"
                              onClick={(e) => handleLeave(e, agent)}
                            >
                              휴직
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-300 hover:bg-red-500/15"
                              onClick={(e) => handleFire(e, agent)}
                            >
                              해고
                            </Button>
                          </>
                        )}
                        {agent.isActive && agent.onLeave && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-emerald-300 hover:bg-emerald-500/15"
                            onClick={(e) => handleRestore(e, agent)}
                          >
                            복직
                          </Button>
                        )}
                        {!agent.isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-accent-400"
                            onClick={(e) => handleBackupList(e, agent)}
                          >
                            재채용
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {agents.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-9 text-center text-sm text-text-muted">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-surface-800/75 text-text-secondary">
              <AppIcon name="users" size={17} />
            </span>
            <span>등록된 에이전트가 없습니다.</span>
            <Button
              size="sm"
              onClick={openCreateModal}
              leadingIcon={<AppIcon name="plus" size={14} />}
            >
              첫 에이전트 채용하기
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
