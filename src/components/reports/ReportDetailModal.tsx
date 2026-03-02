import { useEffect } from "react";
import { useReportStore } from "../../stores/reportStore";
import type { ReportType } from "../../services/types";

const typeBadge: Record<ReportType, { label: string; className: string }> = {
  daily: { label: "Daily", className: "bg-blue-500/20 text-blue-400" },
  weekly: { label: "Weekly", className: "bg-yellow-500/20 text-yellow-400" },
  monthly: { label: "Monthly", className: "bg-green-500/20 text-green-400" },
};

export function ReportDetailModal() {
  const { showDetailModal, selectedReport, closeDetailModal, deleteReport } =
    useReportStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetailModal();
    };
    if (showDetailModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDetailModal, closeDetailModal]);

  if (!showDetailModal || !selectedReport) return null;

  const badge = typeBadge[selectedReport.reportType] || typeBadge.daily;

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return d;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeDetailModal}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary mb-1">
              {selectedReport.title}
            </h2>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
              <span>
                {formatDate(selectedReport.periodStart)} ~{" "}
                {formatDate(selectedReport.periodEnd)}
              </span>
            </div>
          </div>
          <button
            onClick={closeDetailModal}
            className="text-text-muted hover:text-text-primary transition-colors text-lg shrink-0"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-auto mb-4">
          <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans leading-relaxed">
            {selectedReport.content}
          </pre>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-white/[0.06]">
          <span className="text-[11px] text-text-muted">
            {formatDate(selectedReport.generatedAt)} 생성
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => deleteReport(selectedReport.id)}
              className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm rounded-lg transition-colors"
            >
              삭제
            </button>
            <button
              onClick={closeDetailModal}
              className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-text-primary text-sm rounded-lg transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
