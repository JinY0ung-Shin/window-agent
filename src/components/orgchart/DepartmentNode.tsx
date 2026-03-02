import { useDroppable } from "@dnd-kit/core";
import type { OrgChartNode } from "../../services/types";
import { AgentChip } from "./AgentChip";
import { useOrgChartStore } from "../../stores/orgChartStore";

interface DepartmentNodeProps {
  node: OrgChartNode;
}

export function DepartmentNode({ node }: DepartmentNodeProps) {
  const { setNodeRef, isOver } = useDroppable({ id: node.department.name });
  const { openDeptModal, deleteDepartment } = useOrgChartStore();

  return (
    <div
      ref={setNodeRef}
      className={`bg-surface-800 border rounded-2xl p-4 transition-colors ${
        isOver
          ? "border-accent-500/40 bg-surface-800/80"
          : "border-white/[0.06]"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {node.department.name}
          </h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            {node.department.description}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-text-muted mr-1">
            {node.agents.length}명
          </span>
          <button
            onClick={() => openDeptModal(node.department)}
            className="p-1 hover:bg-surface-700 rounded-lg transition-colors text-text-muted hover:text-text-primary"
            title="수정"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => deleteDepartment(node.department.id)}
            className="p-1 hover:bg-red-500/20 rounded-lg transition-colors text-text-muted hover:text-red-400"
            title="삭제"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {node.agents.map((agent) => (
          <AgentChip key={agent.id} agent={agent} />
        ))}
        {node.agents.length === 0 && (
          <span className="text-xs text-text-muted py-2">
            소속 에이전트 없음
          </span>
        )}
      </div>
    </div>
  );
}
