import { create } from "zustand";

export type MainView = "chat" | "network" | "vault" | "team";

const LS_KEY = "main_view";

interface NavigationState {
  mainView: MainView;
  setMainView: (view: MainView) => void;
  toggleView: (view: MainView) => void;
}

const VALID_VIEWS: MainView[] = ["chat", "network", "vault", "team"];

function loadMainView(): MainView {
  const stored = localStorage.getItem(LS_KEY);
  if (stored && VALID_VIEWS.includes(stored as MainView)) {
    return stored as MainView;
  }
  return "chat";
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  mainView: loadMainView(),

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
