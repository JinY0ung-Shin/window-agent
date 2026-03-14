import { useEffect } from "react";
import { useSettingsStore } from "./stores/settingsStore";
import { useChatStore } from "./stores/chatStore";
import { useAgentStore } from "./stores/agentStore";
import * as cmds from "./services/tauriCommands";
import MainLayout from "./components/layout/MainLayout";
import SettingsModal from "./components/settings/SettingsModal";
import "./App.css";

function App() {
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadEnvDefaults = useSettingsStore((s) => s.loadEnvDefaults);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  useEffect(() => {
    loadSettings();
    loadEnvDefaults();

    // Initialize agents: seed manager → sync FS → load into store
    cmds.seedManagerAgent()
      .catch((e) => console.warn("seedManagerAgent:", e))
      .then(() => cmds.syncAgentsFromFs())
      .catch((e) => console.warn("syncAgentsFromFs:", e))
      .then(() => {
        loadAgents();
        loadConversations();
      });
  }, []);

  return (
    <>
      <MainLayout />
      <SettingsModal />
    </>
  );
}

export default App;
