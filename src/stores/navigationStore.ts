import { create } from "zustand";

export type MainView = "chat" | "network" | "vault" | "team" | "cron" | "settings";

const LS_KEY = "main_view";

interface NavigationState {
  mainView: MainView;
  previousView: MainView;
  setMainView: (view: MainView) => void;
  toggleView: (view: MainView) => void;
  goBack: () => void;
}

const VALID_VIEWS: MainView[] = ["chat", "network", "vault", "team", "cron", "settings"];

function loadMainView(): MainView {
  const stored = localStorage.getItem(LS_KEY);
  if (stored && VALID_VIEWS.includes(stored as MainView)) {
    return stored as MainView;
  }
  return "chat";
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  mainView: loadMainView(),
  previousView: "chat",

  setMainView: (view) => {
    const current = get().mainView;
    // Don't persist "settings" — it's a transient view, not a destination
    if (view !== "settings") localStorage.setItem(LS_KEY, view);
    set({ mainView: view, previousView: current });
  },

  toggleView: (view) => {
    const current = get().mainView;
    const next = current === view ? "chat" : view;
    if (next !== "settings") localStorage.setItem(LS_KEY, next);
    set({ mainView: next, previousView: current });
  },

  goBack: () => {
    const prev = get().previousView;
    const target = prev === "settings" ? "chat" : prev;
    localStorage.setItem(LS_KEY, target);
    set({ mainView: target });
  },
}));
