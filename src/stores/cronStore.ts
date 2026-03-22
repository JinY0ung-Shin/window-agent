import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type {
  CronJob,
  CronRun,
  CreateCronJobRequest,
  UpdateCronJobRequest,
} from "../services/types";
import * as cronCmds from "../services/commands/cronCommands";
import { logger } from "../services/logger";

interface CronState {
  jobs: CronJob[];
  selectedJobId: string | null;
  isEditorOpen: boolean;
  editingJobId: string | null;
  runs: CronRun[];

  loadJobs: () => Promise<void>;
  loadJobsForAgent: (agentId: string) => Promise<void>;
  createJob: (request: CreateCronJobRequest) => Promise<CronJob>;
  updateJob: (id: string, request: UpdateCronJobRequest) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  selectJob: (id: string | null) => void;
  openEditor: (jobId?: string) => void;
  closeEditor: () => void;
  loadRuns: (jobId: string) => Promise<void>;
  setupListeners: () => Promise<() => void>;
}

export const useCronStore = create<CronState>((set, get) => ({
  jobs: [],
  selectedJobId: null,
  isEditorOpen: false,
  editingJobId: null,
  runs: [],

  loadJobs: async () => {
    try {
      const jobs = await cronCmds.listCronJobs();
      set({ jobs });
    } catch (e) {
      logger.error("Failed to load cron jobs:", e);
      set({ jobs: [] });
    }
  },

  loadJobsForAgent: async (agentId) => {
    try {
      const jobs = await cronCmds.listCronJobsForAgent(agentId);
      set({ jobs });
    } catch (e) {
      logger.error("Failed to load cron jobs for agent:", e);
      set({ jobs: [] });
    }
  },

  createJob: async (request) => {
    const job = await cronCmds.createCronJob(request);
    await get().loadJobs();
    return job;
  },

  updateJob: async (id, request) => {
    await cronCmds.updateCronJob(id, request);
    await get().loadJobs();
  },

  deleteJob: async (id) => {
    try {
      await cronCmds.deleteCronJob(id);
      const { selectedJobId } = get();
      if (selectedJobId === id) {
        set({ selectedJobId: null, runs: [] });
      }
      await get().loadJobs();
    } catch (e) {
      logger.error("Failed to delete cron job:", e);
    }
  },

  toggleJob: async (id, enabled) => {
    try {
      await cronCmds.toggleCronJob(id, enabled);
      await get().loadJobs();
    } catch (e) {
      logger.error("Failed to toggle cron job:", e);
    }
  },

  selectJob: (id) => set({ selectedJobId: id }),

  openEditor: (jobId) =>
    set({
      isEditorOpen: true,
      editingJobId: jobId ?? null,
    }),

  closeEditor: () =>
    set({
      isEditorOpen: false,
      editingJobId: null,
    }),

  loadRuns: async (jobId) => {
    try {
      const runs = await cronCmds.listCronRuns(jobId);
      set({ runs });
    } catch (e) {
      logger.error("Failed to load cron runs:", e);
      set({ runs: [] });
    }
  },

  setupListeners: async () => {
    // Idempotent: skip if already registered
    const store = useCronStore as unknown as { _listenersRegistered?: boolean };
    if (store._listenersRegistered) return () => {};

    const refresh = () => get().loadJobs();
    try {
      const unlistens = await Promise.all([
        listen("cron:job-started", refresh),
        listen("cron:job-completed", refresh),
        listen("cron:job-failed", refresh),
      ]);
      store._listenersRegistered = true;
      return () => {
        unlistens.forEach((fn) => fn());
        store._listenersRegistered = false;
      };
    } catch (e) {
      // Don't set flag on failure — allow retry
      logger.error("Failed to setup cron listeners:", e);
      return () => {};
    }
  },
}));
