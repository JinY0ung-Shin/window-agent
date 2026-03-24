import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useTourStore, TOUR_STEPS } from "../../stores/tourStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useAgentStore } from "../../stores/agentStore";
import { useConversationStore } from "../../stores/conversationStore";
import type { MainView } from "../../stores/navigationStore";
import "../../styles/tour.css";

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function TourOverlay() {
  const { t } = useTranslation("onboarding");
  const tourActive = useTourStore((s) => s.tourActive);
  const tourPending = useTourStore((s) => s.tourPending);
  const tourCompleted = useTourStore((s) => s.tourCompleted);
  const currentStepIndex = useTourStore((s) => s.currentStepIndex);
  const startTour = useTourStore((s) => s.startTour);
  const advanceStep = useTourStore((s) => s.advanceStep);
  const skipTour = useTourStore((s) => s.skipTour);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const cancelRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-start tour when pending and not completed
  useEffect(() => {
    if (tourPending && !tourCompleted && !tourActive) {
      const timer = setTimeout(() => startTour(), 500);
      return () => clearTimeout(timer);
    }
  }, [tourPending, tourCompleted, tourActive, startTour]);

  // Focus next button when tooltip appears
  useEffect(() => {
    if (rect && nextBtnRef.current) {
      nextBtnRef.current.focus();
    }
  }, [rect, currentStepIndex]);

  // Keyboard handling
  useEffect(() => {
    if (!tourActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        skipTour();
      } else if (e.key === "Enter" || e.key === " ") {
        // Only if focus is on the overlay (not on app controls)
        if ((e.target as HTMLElement)?.closest(".tour-tooltip")) {
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tourActive, skipTour]);

  // Navigate to target view and find element for current step
  const locateTarget = useCallback(() => {
    if (!tourActive) return;
    const step = TOUR_STEPS[currentStepIndex];
    if (!step) return;

    // Cancel any previous async work
    cancelRef.current = true;
    // Create a new cancel token for this invocation
    const myCancelRef = { cancelled: false };
    cancelRef.current = false;

    // Navigate to the required view if specified
    if (step.targetView) {
      const currentView = useNavigationStore.getState().mainView;
      if (currentView !== step.targetView) {
        useNavigationStore.getState().setMainView(step.targetView as MainView);
      }
    }

    // Auto-select manager agent for chat-input step
    if (step.selectAgent) {
      const agents = useAgentStore.getState().agents;
      const defaultAgent = agents.find((a) => a.is_default) || agents[0];
      if (defaultAgent) {
        useConversationStore.getState().openAgentChat(defaultAgent.id);
      }
    }

    // Wait for element to mount, then measure
    const findElement = (retries: number) => {
      if (myCancelRef.cancelled) return;
      const el = document.querySelector(`[data-tour-id="${step.tourId}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (!myCancelRef.cancelled) {
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
        return;
      }
      if (retries > 0) {
        requestAnimationFrame(() => findElement(retries - 1));
      } else if (!myCancelRef.cancelled) {
        // Element not found — skip this step gracefully
        setRect(null);
        advanceStep();
      }
    };

    // Reset rect and find after a short delay for navigation to settle
    setRect(null);
    const timeoutId = setTimeout(() => findElement(20), 100);

    return () => {
      myCancelRef.cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [tourActive, currentStepIndex, advanceStep]);

  useEffect(() => {
    const cleanup = locateTarget();
    return cleanup;
  }, [locateTarget]);

  // Update rect on resize
  useEffect(() => {
    if (!tourActive) return;
    const handleResize = () => locateTarget();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [tourActive, locateTarget]);

  if (!tourActive || !rect) return null;

  const step = TOUR_STEPS[currentStepIndex];
  if (!step) return null;

  const padding = 8;
  const tooltipWidth = 280;
  const tooltipEstimatedHeight = 160;

  // Position tooltip: below if space, otherwise above
  const spaceBelow = window.innerHeight - (rect.top + rect.height + padding);
  const placeAbove = spaceBelow < tooltipEstimatedHeight + 24;
  const tooltipTop = placeAbove
    ? Math.max(12, rect.top - padding - tooltipEstimatedHeight - 12)
    : rect.top + rect.height + padding + 12;
  const tooltipLeft = Math.max(12, Math.min(rect.left, window.innerWidth - tooltipWidth - 12));

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={t(step.titleKey)}>
      {/* Dim background with cutout */}
      <svg className="tour-backdrop" width="100%" height="100%">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={rect.left - padding}
              y={rect.top - padding}
              width={rect.width + padding * 2}
              height={rect.height + padding * 2}
              rx="8"
              fill="black"
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#tour-mask)" />
      </svg>

      {/* Spotlight border */}
      <div
        className="tour-spotlight"
        style={{
          top: rect.top - padding,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="tour-tooltip"
        style={{ top: tooltipTop, left: tooltipLeft, maxWidth: tooltipWidth }}
      >
        <div className="tour-tooltip-step">
          {currentStepIndex + 1} / {TOUR_STEPS.length}
        </div>
        <h3 className="tour-tooltip-title">{t(step.titleKey)}</h3>
        <p className="tour-tooltip-desc">{t(step.descKey)}</p>
        <div className="tour-tooltip-actions">
          <button className="tour-skip-btn" onClick={skipTour}>
            {t("tour.skipButton")}
          </button>
          <button ref={nextBtnRef} className="tour-next-btn" onClick={advanceStep}>
            {currentStepIndex === TOUR_STEPS.length - 1 ? t("tour.doneButton") : t("tour.nextButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
