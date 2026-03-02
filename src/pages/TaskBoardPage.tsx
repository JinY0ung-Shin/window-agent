import { useEffect, useState } from "react";
import { useTaskStore } from "../stores/taskStore";
import { KanbanBoard } from "../components/taskboard/KanbanBoard";
import { TaskCreateModal } from "../components/taskboard/TaskCreateModal";
import { TaskDetailModal } from "../components/taskboard/TaskDetailModal";
import { SchedulePanel } from "../components/taskboard/SchedulePanel";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { PageShell } from "../components/ui/PageShell";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { AppIcon } from "../components/ui/AppIcon";

type TabType = "kanban" | "schedule";

export function TaskBoardPage() {
  const { fetchTasks, showCreateModal, showDetailModal, openCreateModal } = useTaskStore();
  const [activeTab, setActiveTab] = useState<TabType>("kanban");

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <PageShell>
      <PageHeader
        icon="tasks"
        title="업무보드"
        description={
          activeTab === "kanban"
            ? "칸반 보드로 에이전트 업무를 관리합니다."
            : "반복 업무 자동화를 위한 스케줄을 관리합니다."
        }
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl<TabType>
              items={[
                { value: "kanban", label: "칸반" },
                { value: "schedule", label: "스케줄", icon: "clock" },
              ]}
              value={activeTab}
              onChange={setActiveTab}
            />
            {activeTab === "kanban" && (
              <Button
                onClick={openCreateModal}
                leadingIcon={<AppIcon name="plus" size={15} />}
              >
                업무 추가
              </Button>
            )}
          </div>
        }
      />

      {activeTab === "kanban" ? (
        <>
          <KanbanBoard />
          {showCreateModal && <TaskCreateModal />}
          {showDetailModal && <TaskDetailModal />}
        </>
      ) : (
        <SchedulePanel />
      )}
    </PageShell>
  );
}
