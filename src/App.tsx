import { useEffect } from "react";
import { useSettingsStore } from "./stores/settingsStore";
import { useChatStore } from "./stores/chatStore";
import MainLayout from "./components/layout/MainLayout";
import SettingsModal from "./components/settings/SettingsModal";
import "./App.css";

function App() {
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadConversations = useChatStore((s) => s.loadConversations);

  useEffect(() => {
    loadSettings();
    loadConversations();
  }, []);

  return (
    <>
      <MainLayout />
      <SettingsModal />
    </>
  );
}

export default App;
