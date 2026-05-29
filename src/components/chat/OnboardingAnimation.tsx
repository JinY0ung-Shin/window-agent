import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useSettingsStore } from "../../stores/settingsStore";

interface Step {
  emoji: string;
  text: string;
}

const STEP_INTERVAL = 1400;
const MIN_STEPS = 4;
const FINAL_DELAY = 1200;

export default function OnboardingAnimation() {
  const onboardingAgentId = useBootstrapStore((s) => s.onboardingAgentId);
  const finishOnboarding = useBootstrapStore((s) => s.finishOnboarding);
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const { t } = useTranslation("chat");

  const themeKey = uiTheme === "classic" ? "classic" : "org";
  const steps = t(`onboardingAnim.${themeKey}.steps`, { returnObjects: true }) as Step[];
  const finalStep = t(`onboardingAnim.${themeKey}.final`, { returnObjects: true }) as Step;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<"cycling" | "final">("cycling");
  const stepsShownRef = useRef(0);
  const readyRef = useRef(false);

  useEffect(() => {
    if (onboardingAgentId) readyRef.current = true;
  }, [onboardingAgentId]);

  useEffect(() => {
    if (phase !== "cycling") return;

    const timer = setInterval(() => {
      stepsShownRef.current += 1;

      if (readyRef.current && stepsShownRef.current >= MIN_STEPS) {
        setPhase("final");
        clearInterval(timer);
        return;
      }

      setCurrentIndex((prev) => (prev + 1) % steps.length);
    }, STEP_INTERVAL);

    return () => clearInterval(timer);
  }, [phase, steps.length]);

  useEffect(() => {
    if (phase !== "final") return;
    const timer = setTimeout(() => {
      finishOnboarding();
    }, FINAL_DELAY);
    return () => clearTimeout(timer);
  }, [phase, finishOnboarding]);

  const current = phase === "final" ? finalStep : steps[currentIndex];

  return (
    <div className="onboarding-step" key={phase === "final" ? "final" : currentIndex}>
      <span className="onboarding-emoji">{current.emoji}</span>
      <span className="onboarding-text">{current.text}</span>
    </div>
  );
}
