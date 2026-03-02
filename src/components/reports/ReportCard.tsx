import type { Report, ReportType } from "../../services/types";
import { useReportStore } from "../../stores/reportStore";

const typeBadge: Record<ReportType, { label: string; className: string }> = {
  daily: { label: "Daily", className: "bg-blue-500/20 text-blue-400" },
  weekly: { label: "Weekly", className: "bg-yellow-500/20 text-yellow-400" },
  monthly: { label: "Monthly", className: "bg-green-500/20 text-green-400" },
};

interface ReportCardProps {
  report: Report;
}

export function ReportCard({ report }: ReportCardProps) {
  const { openDetailModal } = useReportStore();
  const badge = typeBadge[report.reportType] || typeBadge.daily;

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
    <div
      onClick={() => openDetailModal(report)}
      className="bg-surface-800 border border-white/[0.06] rounded-2xl p-4 cursor-pointer hover:bg-surface-700/60 transition-all flex flex-col min-h-[100px]"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-primary leading-tight line-clamp-2">
          {report.title}
        </h3>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
        <span>{formatDate(report.periodStart)}</span>
        <span>~</span>
        <span>{formatDate(report.periodEnd)}</span>
      </div>

      <div className="text-xs text-text-muted">
        {formatDate(report.generatedAt)} 생성
      </div>
    </div>
  );
}
