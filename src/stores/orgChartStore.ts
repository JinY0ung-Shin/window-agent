import { create } from "zustand";
import type { OrgChartNode, Department } from "../services/types";
import {
  getOrgChart,
  moveAgentDepartment as moveAgentDepartmentCmd,
  createDepartment as createDepartmentCmd,
  updateDepartmentCmd,
  deleteDepartment as deleteDepartmentCmd,
} from "../services/tauriCommands";

interface OrgChartState {
  nodes: OrgChartNode[];
  loading: boolean;
  editingDept: Department | null;
  showDeptModal: boolean;
  fetchOrgChart: () => Promise<void>;
  moveAgentDepartment: (agentId: string, newDepartment: string) => Promise<void>;
  createDepartment: (name: string, description: string) => Promise<void>;
  updateDepartment: (deptId: string, name?: string, description?: string) => Promise<void>;
  deleteDepartment: (deptId: string) => Promise<void>;
  openDeptModal: (dept?: Department) => void;
  closeDeptModal: () => void;
}

export const useOrgChartStore = create<OrgChartState>((set, get) => ({
  nodes: [],
  loading: false,
  editingDept: null,
  showDeptModal: false,

  fetchOrgChart: async () => {
    set({ loading: true });
    const nodes = await getOrgChart();
    set({ nodes, loading: false });
  },

  moveAgentDepartment: async (agentId, newDepartment) => {
    await moveAgentDepartmentCmd(agentId, newDepartment);
    await get().fetchOrgChart();
  },

  createDepartment: async (name, description) => {
    await createDepartmentCmd(name, description);
    await get().fetchOrgChart();
    set({ showDeptModal: false, editingDept: null });
  },

  updateDepartment: async (deptId, name, description) => {
    await updateDepartmentCmd(deptId, name, description);
    await get().fetchOrgChart();
    set({ showDeptModal: false, editingDept: null });
  },

  deleteDepartment: async (deptId) => {
    await deleteDepartmentCmd(deptId);
    await get().fetchOrgChart();
  },

  openDeptModal: (dept?) => {
    set({ showDeptModal: true, editingDept: dept || null });
  },

  closeDeptModal: () => {
    set({ showDeptModal: false, editingDept: null });
  },
}));
