import { create } from "zustand";

export type MainView = "chat" | "network" | "vault";

const LS_KEY = "main_view";

interface NavigationState {
  mainView: MainView;
  setMainView: (view: MainView) => void;
  toggleView: (view: MainView) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  mainView: (localStorage.getItem(LS_KEY) as MainView) || "chat",

  setMainView: (view) => {
    localStorage.setItem(LS_KEY, view);
    set({ mainView: view });
  },

  toggleView: (view) => {
    const current = get().mainView;
    const next = current === view ? "chat" : view;
    localStorage.setItem(LS_KEY, next);
    set({ mainView: next });
  },
}));
