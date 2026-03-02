import { create } from "zustand";
import type { Report, Evaluation, PerformanceSummary, ReportType } from "../services/types";
import {
  getReports as getReportsCmd,
  generateReport as generateReportCmd,
  deleteReport as deleteReportCmd,
  getEvaluations as getEvaluationsCmd,
  evaluateAgent as evaluateAgentCmd,
  getAgentPerformanceSummary as getPerformanceCmd,
} from "../services/tauriCommands";

interface ReportState {
  reports: Report[];
  evaluations: Evaluation[];
  performanceSummaries: Map<string, PerformanceSummary>;
  selectedReport: Report | null;
  loading: boolean;
  reportTypeFilter: ReportType | "all";
  showDetailModal: boolean;
  showGenerateModal: boolean;

  fetchReports: (reportType?: ReportType) => Promise<void>;
  generateReport: (reportType: ReportType, periodStart: string, periodEnd: string) => Promise<void>;
  deleteReport: (reportId: string) => Promise<void>;
  fetchEvaluations: (agentId?: string) => Promise<void>;
  evaluateAgent: (agentId: string, period: string) => Promise<void>;
  fetchPerformanceSummary: (agentId: string) => Promise<void>;

  setReportTypeFilter: (filter: ReportType | "all") => void;
  openDetailModal: (report: Report) => void;
  closeDetailModal: () => void;
  openGenerateModal: () => void;
  closeGenerateModal: () => void;
}

export const useReportStore = create<ReportState>((set, get) => ({
  reports: [],
  evaluations: [],
  performanceSummaries: new Map(),
  selectedReport: null,
  loading: false,
  reportTypeFilter: "all",
  showDetailModal: false,
  showGenerateModal: false,

  fetchReports: async (reportType?) => {
    set({ loading: true });
    const reports = await getReportsCmd(reportType);
    set({ reports, loading: false });
  },

  generateReport: async (reportType, periodStart, periodEnd) => {
    set({ loading: true });
    await generateReportCmd(reportType, periodStart, periodEnd);
    await get().fetchReports();
    set({ showGenerateModal: false, loading: false });
  },

  deleteReport: async (reportId) => {
    await deleteReportCmd(reportId);
    await get().fetchReports();
    set({ showDetailModal: false, selectedReport: null });
  },

  fetchEvaluations: async (agentId?) => {
    const evaluations = await getEvaluationsCmd(agentId);
    set({ evaluations });
  },

  evaluateAgent: async (agentId, period) => {
    set({ loading: true });
    await evaluateAgentCmd(agentId, period);
    await get().fetchEvaluations();
    await get().fetchPerformanceSummary(agentId);
    set({ loading: false });
  },

  fetchPerformanceSummary: async (agentId) => {
    const summary = await getPerformanceCmd(agentId);
    set((state) => {
      const newMap = new Map(state.performanceSummaries);
      newMap.set(agentId, summary);
      return { performanceSummaries: newMap };
    });
  },

  setReportTypeFilter: (filter) => set({ reportTypeFilter: filter }),

  openDetailModal: (report) => set({ selectedReport: report, showDetailModal: true }),
  closeDetailModal: () => set({ showDetailModal: false, selectedReport: null }),

  openGenerateModal: () => set({ showGenerateModal: true }),
  closeGenerateModal: () => set({ showGenerateModal: false }),
}));
