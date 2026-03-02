import { create } from "zustand";
import type { CostSummary, DailyCost, CostRecord } from "../services/types";
import {
  getCostSummary as getCostSummaryCmd,
  getCostTrend as getCostTrendCmd,
  getAgentCostHistory as getAgentCostHistoryCmd,
} from "../services/tauriCommands";

interface CostState {
  summary: CostSummary | null;
  trend: DailyCost[];
  agentHistory: CostRecord[];
  loading: boolean;
  periodStart?: string;
  periodEnd?: string;
  fetchCostSummary: (periodStart?: string, periodEnd?: string) => Promise<void>;
  fetchCostTrend: (days?: number) => Promise<void>;
  fetchAgentCostHistory: (agentId: string, limit?: number) => Promise<void>;
  setPeriod: (start?: string, end?: string) => void;
}

export const useCostStore = create<CostState>((set) => ({
  summary: null,
  trend: [],
  agentHistory: [],
  loading: false,
  periodStart: undefined,
  periodEnd: undefined,

  fetchCostSummary: async (periodStart?: string, periodEnd?: string) => {
    set({ loading: true });
    try {
      const summary = await getCostSummaryCmd(periodStart, periodEnd);
      set({ summary, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchCostTrend: async (days?: number) => {
    try {
      const trend = await getCostTrendCmd(days);
      set({ trend });
    } catch {
      // ignore
    }
  },

  fetchAgentCostHistory: async (agentId: string, limit?: number) => {
    try {
      const agentHistory = await getAgentCostHistoryCmd(agentId, limit);
      set({ agentHistory });
    } catch {
      // ignore
    }
  },

  setPeriod: (start?: string, end?: string) => {
    set({ periodStart: start, periodEnd: end });
  },
}));
