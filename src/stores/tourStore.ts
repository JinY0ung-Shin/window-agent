import { create } from "zustand";

const LS_TOUR_PENDING = "tour_pending";
const LS_TOUR_COMPLETED = "tour_completed";

export interface TourStep {
  id: string;
  targetView: string | null; // null = any view (always-mounted elements)
  tourId: string;            // data-tour-id value
  titleKey: string;          // i18n key for title
  descKey: string;           // i18n key for description
  selectAgent?: boolean;     // auto-select manager agent before this step
}

export const TOUR_STEPS: TourStep[] = [
  { id: "sidebar-agents", targetView: null, tourId: "sidebar-agents", titleKey: "tour.step1Title", descKey: "tour.step1Desc" },
  { id: "chat-input", targetView: "chat", tourId: "chat-input", titleKey: "tour.step2Title", descKey: "tour.step2Desc", selectAgent: true },
  { id: "agent-add-btn", targetView: "agent", tourId: "agent-add-btn", titleKey: "tour.step3Title", descKey: "tour.step3Desc" },
  { id: "sidebar-settings", targetView: null, tourId: "sidebar-settings", titleKey: "tour.step4Title", descKey: "tour.step4Desc" },
  { id: "team-menu", targetView: null, tourId: "sidebar-team", titleKey: "tour.step5Title", descKey: "tour.step5Desc" },
];

interface TourState {
  tourPending: boolean;
  tourCompleted: boolean;
  tourActive: boolean;
  currentStepIndex: number;
  startTour: () => void;
  advanceStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
  setTourPending: () => void;
  resetTour: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  tourPending: localStorage.getItem(LS_TOUR_PENDING) === "true",
  tourCompleted: localStorage.getItem(LS_TOUR_COMPLETED) === "true",
  tourActive: false,
  currentStepIndex: 0,

  startTour: () => {
    set({ tourActive: true, currentStepIndex: 0 });
  },

  advanceStep: () => {
    const { currentStepIndex } = get();
    const next = currentStepIndex + 1;
    if (next >= TOUR_STEPS.length) {
      get().completeTour();
    } else {
      set({ currentStepIndex: next });
    }
  },

  skipTour: () => {
    get().completeTour();
  },

  completeTour: () => {
    localStorage.setItem(LS_TOUR_COMPLETED, "true");
    localStorage.removeItem(LS_TOUR_PENDING);
    set({ tourActive: false, tourCompleted: true, tourPending: false });
  },

  setTourPending: () => {
    localStorage.setItem(LS_TOUR_PENDING, "true");
    set({ tourPending: true });
  },

  resetTour: () => {
    localStorage.setItem(LS_TOUR_PENDING, "true");
    localStorage.removeItem(LS_TOUR_COMPLETED);
    set({ tourPending: true, tourCompleted: false, currentStepIndex: 0 });
  },
}));
