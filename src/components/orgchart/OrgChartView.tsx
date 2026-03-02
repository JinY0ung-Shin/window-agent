import { useEffect } from "react";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { useOrgChartStore } from "../../stores/orgChartStore";
import { DepartmentNode } from "./DepartmentNode";
import { EmptyState } from "../ui/EmptyState";

export function OrgChartView() {
  const { nodes, loading, fetchOrgChart, moveAgentDepartment } = useOrgChartStore();

  useEffect(() => {
    fetchOrgChart();
  }, [fetchOrgChart]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const agentId = active.id as string;
    const targetDeptName = over.id as string;

    const currentNode = nodes.find((n) => n.agents.some((a) => a.id === agentId));
    if (!currentNode || currentNode.department.name === targetDeptName) return;

    moveAgentDepartment(agentId, targetDeptName);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-sm text-text-muted">로딩 중...</div>;
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {nodes.length === 0 ? (
        <EmptyState
          icon="building"
          title="등록된 부서가 없습니다"
          description="부서를 추가한 뒤 에이전트를 배치해 보세요."
          className="rounded-xl border border-white/[0.08] bg-surface-800/80"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {nodes.map((node) => (
            <DepartmentNode key={node.department.id} node={node} />
          ))}
        </div>
      )}
    </DndContext>
  );
}
