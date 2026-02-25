import { create } from "zustand";

export type Page = "dashboard" | "chat" | "hr" | "tasks" | "settings";

interface UiState {
  activePage: Page;
  sidebarCollapsed: boolean;
  setActivePage: (page: Page) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activePage: "dashboard",
  sidebarCollapsed: false,
  setActivePage: (page) => set({ activePage: page }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
