import { create } from "zustand";
import type {
  ScheduledTask,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  Task,
} from "../services/types";
import {
  getScheduledTasks as getScheduledTasksCmd,
  createScheduledTask as createScheduledTaskCmd,
  updateScheduledTask as updateScheduledTaskCmd,
  deleteScheduledTask as deleteScheduledTaskCmd,
  triggerScheduledTask as triggerScheduledTaskCmd,
} from "../services/tauriCommands";

interface ScheduleState {
  scheduledTasks: ScheduledTask[];
  loading: boolean;
  showCreateModal: boolean;
  showEditModal: boolean;
  selectedSchedule: ScheduledTask | null;
  fetchScheduledTasks: () => Promise<void>;
  createScheduledTask: (request: CreateScheduledTaskRequest) => Promise<void>;
  updateScheduledTask: (taskId: string, request: UpdateScheduledTaskRequest) => Promise<void>;
  deleteScheduledTask: (taskId: string) => Promise<void>;
  triggerScheduledTask: (taskId: string) => Promise<Task>;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openEditModal: (schedule: ScheduledTask) => void;
  closeEditModal: () => void;
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  scheduledTasks: [],
  loading: false,
  showCreateModal: false,
  showEditModal: false,
  selectedSchedule: null,

  fetchScheduledTasks: async () => {
    set({ loading: true });
    const scheduledTasks = await getScheduledTasksCmd();
    set({ scheduledTasks, loading: false });
  },

  createScheduledTask: async (request) => {
    await createScheduledTaskCmd(request);
    await get().fetchScheduledTasks();
    set({ showCreateModal: false });
  },

  updateScheduledTask: async (taskId, request) => {
    await updateScheduledTaskCmd(taskId, request);
    await get().fetchScheduledTasks();
    set({ showEditModal: false, selectedSchedule: null });
  },

  deleteScheduledTask: async (taskId) => {
    await deleteScheduledTaskCmd(taskId);
    await get().fetchScheduledTasks();
    set({ showEditModal: false, selectedSchedule: null });
  },

  triggerScheduledTask: async (taskId) => {
    const task = await triggerScheduledTaskCmd(taskId);
    await get().fetchScheduledTasks();
    return task;
  },

  openCreateModal: () => set({ showCreateModal: true }),
  closeCreateModal: () => set({ showCreateModal: false }),
  openEditModal: (schedule) => set({ showEditModal: true, selectedSchedule: schedule }),
  closeEditModal: () => set({ showEditModal: false, selectedSchedule: null }),
}));
