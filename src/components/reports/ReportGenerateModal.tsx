import { useEffect, useState } from "react";
import { useReportStore } from "../../stores/reportStore";
import type { ReportType } from "../../services/types";

export function ReportGenerateModal() {
  const { showGenerateModal, closeGenerateModal, generateReport, loading } =
    useReportStore();

  const [reportType, setReportType] = useState<ReportType>("weekly");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  useEffect(() => {
    if (showGenerateModal) {
      const now = new Date();
      const end = now.toISOString().split("T")[0];
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      setPeriodStart(start);
      setPeriodEnd(end);
      setReportType("weekly");
    }
  }, [showGenerateModal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGenerateModal();
    };
    if (showGenerateModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showGenerateModal, closeGenerateModal]);

  if (!showGenerateModal) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodStart || !periodEnd) return;
    await generateReport(reportType, periodStart, periodEnd);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeGenerateModal}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          보고서 생성
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              보고서 유형
            </label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="w-full bg-surface-700 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
            >
              <option value="daily">일간 (Daily)</option>
              <option value="weekly">주간 (Weekly)</option>
              <option value="monthly">월간 (Monthly)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              시작일
            </label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full bg-surface-700 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              종료일
            </label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full bg-surface-700 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeGenerateModal}
              className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-text-primary text-sm rounded-lg transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? "생성 중..." : "생성"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
