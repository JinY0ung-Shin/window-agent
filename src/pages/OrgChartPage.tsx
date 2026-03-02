import { useOrgChartStore } from "../stores/orgChartStore";
import { OrgChartView } from "../components/orgchart/OrgChartView";
import { DepartmentEditModal } from "../components/orgchart/DepartmentEditModal";

export function OrgChartPage() {
  const { openDeptModal } = useOrgChartStore();

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-text-primary">조직도</h1>
          <p className="text-xs text-text-muted mt-1">
            에이전트를 드래그하여 부서를 이동할 수 있습니다
          </p>
        </div>
        <button
          onClick={() => openDeptModal()}
          className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 부서 추가
        </button>
      </div>

      <OrgChartView />
      <DepartmentEditModal />
    </div>
  );
}
