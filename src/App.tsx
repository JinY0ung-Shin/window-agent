import { useEffect } from "react";
import { initializeApp } from "./services/initService";
import { useSettingsStore } from "./stores/settingsStore";
import MainLayout from "./components/layout/MainLayout";
import SettingsModal from "./components/settings/SettingsModal";
import OnboardingScreen from "./components/onboarding/OnboardingScreen";
import "./App.css";

function App() {
  const brandingInitialized = useSettingsStore((s) => s.brandingInitialized);

  useEffect(() => {
    initializeApp();
  }, []);

  if (!brandingInitialized) {
    return <OnboardingScreen />;
  }

  return (
    <>
      <MainLayout />
      <SettingsModal />
    </>
  );
}

export default App;
