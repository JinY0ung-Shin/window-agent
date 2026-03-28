import { useEffect } from "react";
import { initializeApp } from "./services/initService";
import { useSettingsStore } from "./stores/settingsStore";
import MainLayout from "./components/layout/MainLayout";
import OnboardingScreen from "./components/onboarding/OnboardingScreen";
import ErrorBoundary from "./components/common/ErrorBoundary";
import "./App.css";

function App() {
  const brandingInitialized = useSettingsStore((s) => s.brandingInitialized);
  const appReady = useSettingsStore((s) => s.appReady);

  useEffect(() => {
    initializeApp();
  }, []);

  // Wait for initialization to finish before deciding onboarding vs main UI.
  // Prevents a brief onboarding flash for upgraded users.
  if (!appReady) {
    return null;
  }

  if (!brandingInitialized) {
    return <OnboardingScreen />;
  }

  return (
    <ErrorBoundary>
      <MainLayout />
    </ErrorBoundary>
  );
}

export default App;
