import { useEffect } from "react";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { useOrgChartStore } from "../../stores/orgChartStore";
import { DepartmentNode } from "./DepartmentNode";

export function OrgChartView() {
  const { nodes, loading, fetchOrgChart, moveAgentDepartment } =
    useOrgChartStore();

  useEffect(() => {
    fetchOrgChart();
  }, [fetchOrgChart]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const agentId = active.id as string;
    const targetDeptName = over.id as string;

    // Find current department of agent
    const currentNode = nodes.find((n) =>
      n.agents.some((a) => a.id === agentId)
    );
    if (!currentNode || currentNode.department.name === targetDeptName) return;

    moveAgentDepartment(agentId, targetDeptName);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        로딩 중...
      </div>
    );
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {nodes.map((node) => (
          <DepartmentNode key={node.department.id} node={node} />
        ))}
      </div>

      {nodes.length === 0 && (
        <div className="text-center py-12 text-text-muted text-sm">
          등록된 부서가 없습니다. 부서를 추가해 주세요.
        </div>
      )}
    </DndContext>
  );
}
