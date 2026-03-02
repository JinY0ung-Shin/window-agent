import { useOrgChartStore } from "../stores/orgChartStore";
import { OrgChartView } from "../components/orgchart/OrgChartView";
import { DepartmentEditModal } from "../components/orgchart/DepartmentEditModal";
import { PageShell } from "../components/ui/PageShell";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AppIcon } from "../components/ui/AppIcon";

export function OrgChartPage() {
  const { openDeptModal } = useOrgChartStore();

  return (
    <PageShell>
      <PageHeader
        icon="orgchart"
        title="조직도"
        description="드래그 앤 드롭으로 에이전트를 부서 간 이동할 수 있습니다."
        actions={
          <Button
            onClick={() => openDeptModal()}
            leadingIcon={<AppIcon name="plus" size={14} />}
          >
            부서 추가
          </Button>
        }
      />

      <OrgChartView />
      <DepartmentEditModal />
    </PageShell>
  );
}
