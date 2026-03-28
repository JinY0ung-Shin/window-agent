import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Locale } from "../../i18n";

interface Step {
  emoji: string;
  text: string;
}

const STEPS: Record<string, Step[]> = {
  org_ko: [
    { emoji: "📋", text: "면접 결과를 정리하고 있습니다…" },
    { emoji: "📞", text: "합격 통보를 보내고 있습니다…" },
    { emoji: "🪑", text: "자리를 마련하고 있습니다…" },
    { emoji: "🖥️", text: "노트북을 세팅하고 있습니다…" },
    { emoji: "🪴", text: "책상 위에 환영 화분을 올려놓고 있습니다…" },
    { emoji: "🪪", text: "사원증을 발급하고 있습니다…" },
    { emoji: "📇", text: "명함을 인쇄하고 있습니다…" },
    { emoji: "📖", text: "업무 매뉴얼을 전달하고 있습니다…" },
    { emoji: "👋", text: "팀원들에게 소개하고 있습니다…" },
  ],
  org_en: [
    { emoji: "📋", text: "Reviewing interview results…" },
    { emoji: "📞", text: "Sending the offer letter…" },
    { emoji: "🪑", text: "Preparing a workspace…" },
    { emoji: "🖥️", text: "Setting up the laptop…" },
    { emoji: "🪴", text: "Placing a welcome plant on the desk…" },
    { emoji: "🪪", text: "Issuing an employee badge…" },
    { emoji: "📇", text: "Printing business cards…" },
    { emoji: "📖", text: "Handing over the work manual…" },
    { emoji: "👋", text: "Introducing to the team…" },
  ],
  classic_ko: [
    { emoji: "⚙️", text: "에이전트를 초기화하고 있습니다…" },
    { emoji: "🧠", text: "성격 모듈을 로드하고 있습니다…" },
    { emoji: "💾", text: "기억 공간을 생성하고 있습니다…" },
    { emoji: "🔧", text: "도구를 연결하고 있습니다…" },
    { emoji: "🔄", text: "마무리하고 있습니다…" },
  ],
  classic_en: [
    { emoji: "⚙️", text: "Initializing the agent…" },
    { emoji: "🧠", text: "Loading personality modules…" },
    { emoji: "💾", text: "Creating memory space…" },
    { emoji: "🔧", text: "Connecting tools…" },
    { emoji: "🔄", text: "Finalizing setup…" },
  ],
};

const FINAL_STEP: Record<string, Step> = {
  org_ko: { emoji: "✨", text: "첫 출근 준비 완료!" },
  org_en: { emoji: "✨", text: "Ready for the first day!" },
  classic_ko: { emoji: "✨", text: "준비 완료!" },
  classic_en: { emoji: "✨", text: "Ready!" },
};

const STEP_INTERVAL = 1400;
const MIN_STEPS = 4;
const FINAL_DELAY = 1200;

export default function OnboardingAnimation() {
  const onboardingAgentId = useBootstrapStore((s) => s.onboardingAgentId);
  const finishOnboarding = useBootstrapStore((s) => s.finishOnboarding);
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;

  const key = `${uiTheme}_${locale}`;
  const steps = STEPS[key] ?? STEPS.org_ko;
  const finalStep = FINAL_STEP[key] ?? FINAL_STEP.org_ko;

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
