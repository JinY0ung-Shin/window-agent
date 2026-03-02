import { useEffect, useState } from "react";
import { useReportStore } from "../stores/reportStore";
import { ReportCard } from "../components/reports/ReportCard";
import { ReportDetailModal } from "../components/reports/ReportDetailModal";
import { ReportGenerateModal } from "../components/reports/ReportGenerateModal";
import { PerformancePanel } from "../components/reports/PerformancePanel";
import type { ReportType } from "../services/types";

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
    } else {
      fetchReports(filter);
    }
  };

  const filteredReports =
    reportTypeFilter === "all"
      ? reports
      : reports.filter((r) => r.reportType === reportTypeFilter);

  const tabs: { key: Tab; label: string }[] = [
    { key: "reports", label: "보고서" },
    { key: "performance", label: "성과 평가" },
  ];

  const filterOptions: { key: ReportType | "all"; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" },
  ];

  return (
    <div className="h-full p-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-text-primary">보고서</h1>
          <p className="text-xs text-text-muted mt-0.5">
            보고서 생성 및 에이전트 성과 평가
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-800 rounded-xl p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
              activeTab === tab.key
                ? "bg-accent-500 text-white font-medium"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Reports Tab */}
      {activeTab === "reports" && (
        <div>
          {/* Filters + Generate Button */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1">
              {filterOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handleFilterChange(opt.key)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    reportTypeFilter === opt.key
                      ? "bg-accent-500/20 text-accent-400 font-medium"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={openGenerateModal}
              className="px-4 py-1.5 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + 보고서 생성
            </button>
          </div>

          {/* Report Cards Grid */}
          {loading ? (
            <div className="text-center py-12 text-text-muted text-sm">
              로딩 중...
            </div>
          ) : filteredReports.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredReports.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-text-muted text-sm">
              보고서가 없습니다. 새 보고서를 생성해보세요.
            </div>
          )}
        </div>
      )}

      {/* Performance Tab */}
      {activeTab === "performance" && <PerformancePanel />}

      {/* Modals */}
      <ReportDetailModal />
      <ReportGenerateModal />
    </div>
  );
}
