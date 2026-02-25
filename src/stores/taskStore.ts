import { create } from "zustand";
import type { Task, TaskStatus, TaskPriority, CreateTaskRequest, UpdateTaskRequest } from "../services/types";
import {
  getAllTasks,
  createTask as createTaskCmd,
  updateTask as updateTaskCmd,
  deleteTask as deleteTaskCmd,
  updateTaskStatus,
} from "../services/tauriCommands";

interface TaskState {
  tasks: Task[];
  selectedTask: Task | null;
  showCreateModal: boolean;
  showDetailModal: boolean;
  loading: boolean;
  filter: { status?: TaskStatus; priority?: TaskPriority; assigneeId?: string };
  fetchTasks: () => Promise<void>;
  setSelectedTask: (task: Task | null) => void;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openDetailModal: (task?: Task) => void;
  closeDetailModal: () => void;
  createTask: (request: CreateTaskRequest) => Promise<void>;
  updateTask: (taskId: string, request: UpdateTaskRequest) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  moveTask: (taskId: string, newStatus: TaskStatus) => Promise<void>;
  setFilter: (filter: Partial<TaskState["filter"]>) => void;
  getTasksByStatus: (status: TaskStatus) => Task[];
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  selectedTask: null,
  showCreateModal: false,
  showDetailModal: false,
  loading: false,
  filter: {},

  fetchTasks: async () => {
    set({ loading: true });
    const tasks = await getAllTasks();
    set({ tasks, loading: false });
  },

  setSelectedTask: (task) => set({ selectedTask: task }),

  openCreateModal: () => set({ showCreateModal: true }),
  closeCreateModal: () => set({ showCreateModal: false }),

  openDetailModal: (task?) => {
    if (task) {
      set({ selectedTask: task, showDetailModal: true });
    } else {
      set({ showDetailModal: true });
    }
  },
  closeDetailModal: () => set({ showDetailModal: false, selectedTask: null }),

  createTask: async (request) => {
    await createTaskCmd(request);
    await get().fetchTasks();
    set({ showCreateModal: false });
  },

  updateTask: async (taskId, request) => {
    await updateTaskCmd(taskId, request);
    await get().fetchTasks();
    set({ showDetailModal: false, selectedTask: null });
  },

  deleteTask: async (taskId) => {
    await deleteTaskCmd(taskId);
    await get().fetchTasks();
    set({ showDetailModal: false, selectedTask: null });
  },

  moveTask: async (taskId, newStatus) => {
    await updateTaskStatus(taskId, newStatus);
    await get().fetchTasks();
  },

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),

  getTasksByStatus: (status) => {
    const { tasks, filter } = get();
    return tasks.filter((t) => {
      if (t.status !== status) return false;
      if (filter.priority && t.priority !== filter.priority) return false;
      if (filter.assigneeId && t.assigneeId !== filter.assigneeId) return false;
      return true;
    });
  },
}));
