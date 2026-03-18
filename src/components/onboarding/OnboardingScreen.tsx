import { useState } from "react";
import { Building2, Bot, Sparkles } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import type { UITheme } from "../../labels";

export default function OnboardingScreen() {
  const initializeBranding = useSettingsStore((s) => s.initializeBranding);
  const [companyName, setCompanyName] = useState("");
  const [selectedTheme, setSelectedTheme] = useState<UITheme>("org");
  const { compositionProps } = useCompositionInput(setCompanyName);

  const handleStart = () => {
    initializeBranding(companyName.trim(), selectedTheme);
  };

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <div className="onboarding-icon">
          <Sparkles size={40} />
        </div>
        <h1 className="onboarding-title">환영합니다!</h1>
        <p className="onboarding-subtitle">
          회사 이름을 정해주세요
        </p>

        <div className="onboarding-field">
          <label htmlFor="companyName">회사 또는 워크스페이스 이름</label>
          <input
            id="companyName"
            type="text"
            placeholder="예: 스타트업 AI"
            value={companyName}
            autoFocus
            {...compositionProps}
          />
        </div>

        <div className="onboarding-field">
          <label>UI 테마</label>
          <div className="onboarding-theme-buttons">
            <button
              className={`onboarding-theme-btn ${selectedTheme === "classic" ? "selected" : ""}`}
              onClick={() => setSelectedTheme("classic")}
            >
              <Bot size={24} />
              <span className="theme-btn-title">클래식 모드</span>
              <span className="theme-btn-desc">에이전트, 스킬 등 기존 용어 사용</span>
            </button>
            <button
              className={`onboarding-theme-btn ${selectedTheme === "org" ? "selected" : ""}`}
              onClick={() => setSelectedTheme("org")}
            >
              <Building2 size={24} />
              <span className="theme-btn-title">조직 운영 모드</span>
              <span className="theme-btn-desc">직원, 채용 등 회사 메타포 사용</span>
            </button>
          </div>
        </div>

        <button className="onboarding-start-btn" onClick={handleStart} disabled={!companyName.trim()}>
          시작하기
        </button>
      </div>
    </div>
  );
}
