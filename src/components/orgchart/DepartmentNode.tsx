import { useDroppable } from "@dnd-kit/core";
import type { OrgChartNode } from "../../services/types";
import { AgentChip } from "./AgentChip";
import { useOrgChartStore } from "../../stores/orgChartStore";
import { AppIcon } from "../ui/AppIcon";

interface DepartmentNodeProps {
  node: OrgChartNode;
}

export function DepartmentNode({ node }: DepartmentNodeProps) {
  const { setNodeRef, isOver } = useDroppable({ id: node.department.name });
  const { openDeptModal, deleteDepartment } = useOrgChartStore();

  return (
    <section
      ref={setNodeRef}
      className={`min-h-[140px] rounded-2xl border p-4 transition-colors ${
        isOver
          ? "border-accent-500/45 bg-surface-800/90"
          : "border-white/[0.08] bg-surface-800/82"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{node.department.name}</h3>
          <p className="mt-0.5 text-[11px] text-text-muted">{node.department.description}</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 rounded-md bg-surface-700/50 px-1.5 py-0.5 text-xs text-text-muted">
            {node.agents.length}명
          </span>
          <button
            onClick={() => openDeptModal(node.department)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary"
            title="수정"
          >
            <AppIcon name="edit" size={14} />
          </button>
          <button
            onClick={() => deleteDepartment(node.department.id)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-red-500/20 hover:text-red-400"
            title="삭제"
          >
            <AppIcon name="trash" size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {node.agents.map((agent) => (
          <AgentChip key={agent.id} agent={agent} />
        ))}
        {node.agents.length === 0 && <span className="py-2 text-xs text-text-muted">소속 에이전트 없음</span>}
      </div>
    </section>
  );
}
