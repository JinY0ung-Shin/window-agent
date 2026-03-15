import { useEffect } from "react";
import { initializeApp } from "./services/initService";
import MainLayout from "./components/layout/MainLayout";
import SettingsModal from "./components/settings/SettingsModal";
import "./App.css";

function App() {
  useEffect(() => {
    initializeApp();
  }, []);

  return (
    <>
      <MainLayout />
      <SettingsModal />
    </>
  );
}

export default App;
