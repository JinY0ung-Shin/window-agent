import { useEffect, useState } from "react";
import { useReportStore } from "../stores/reportStore";
import { ReportCard } from "../components/reports/ReportCard";
import { ReportDetailModal } from "../components/reports/ReportDetailModal";
import { ReportGenerateModal } from "../components/reports/ReportGenerateModal";
import { PerformancePanel } from "../components/reports/PerformancePanel";
import type { ReportType } from "../services/types";
import { PageShell } from "../components/ui/PageShell";
import { PageHeader } from "../components/ui/PageHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Button } from "../components/ui/Button";
import { AppIcon } from "../components/ui/AppIcon";
import { EmptyState } from "../components/ui/EmptyState";
import { cn } from "../lib/utils";

type Tab = "reports" | "performance";

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("reports");
  const {
    reports,
    loading,
    reportTypeFilter,
    fetchReports,
    setReportTypeFilter,
    openGenerateModal,
  } = useReportStore();

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleFilterChange = (filter: ReportType | "all") => {
    setReportTypeFilter(filter);
    if (filter === "all") {
      fetchReports();
      return;
    }
    fetchReports(filter);
  };

  const filteredReports =
    reportTypeFilter === "all"
      ? reports
      : reports.filter((r) => r.reportType === reportTypeFilter);

  const filterOptions: { key: ReportType | "all"; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" },
  ];

  return (
    <PageShell>
      <PageHeader
        icon="reports"
        title="보고서"
        description="주기별 리포트와 에이전트 성과 평가 결과를 확인합니다."
      />

      <div className="mb-4">
        <SegmentedControl<Tab>
          items={[
            { value: "reports", label: "보고서" },
            { value: "performance", label: "성과 평가", icon: "trendUp" },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {activeTab === "reports" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              {filterOptions.map((opt) => {
                const active = reportTypeFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => handleFilterChange(opt.key)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs transition-colors",
                      active
                        ? "bg-accent-500/18 text-accent-400"
                        : "text-text-secondary hover:bg-surface-700/70 hover:text-text-primary"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              onClick={openGenerateModal}
              leadingIcon={<AppIcon name="plus" size={14} />}
            >
              보고서 생성
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-text-muted">로딩 중...</div>
          ) : filteredReports.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredReports.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="reports"
              title="보고서가 없습니다"
              description="첫 보고서를 생성해 최근 운영 현황을 기록하세요."
              action={
                <Button
                  size="sm"
                  onClick={openGenerateModal}
                  leadingIcon={<AppIcon name="plus" size={14} />}
                >
                  보고서 생성
                </Button>
              }
            />
          )}
        </div>
      )}

      {activeTab === "performance" && <PerformancePanel />}

      <ReportDetailModal />
      <ReportGenerateModal />
    </PageShell>
  );
}
