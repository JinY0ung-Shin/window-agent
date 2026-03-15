import { useSettingsStore } from "../stores/settingsStore";
import { useConversationStore } from "../stores/conversationStore";
import { useAgentStore } from "../stores/agentStore";
import * as cmds from "./tauriCommands";

export async function initializeApp(): Promise<void> {
  const loadSettings = useSettingsStore.getState().loadSettings;
  const loadEnvDefaults = useSettingsStore.getState().loadEnvDefaults;
  const loadAgents = useAgentStore.getState().loadAgents;
  const loadConversations = useConversationStore.getState().loadConversations;

  // Step 1: Load settings (best-effort)
  try {
    loadSettings();
  } catch (e) {
    console.warn("loadSettings:", e);
  }

  // Step 2: Load env defaults (best-effort)
  try {
    loadEnvDefaults();
  } catch (e) {
    console.warn("loadEnvDefaults:", e);
  }

  // Step 3: Seed manager agent (best-effort)
  try {
    await cmds.seedManagerAgent();
  } catch (e) {
    console.warn("seedManagerAgent:", e);
  }

  // Step 4: Sync agents from FS (best-effort)
  try {
    await cmds.syncAgentsFromFs();
  } catch (e) {
    console.warn("syncAgentsFromFs:", e);
  }

  // Step 5: Load agents into store
  try {
    await loadAgents();
  } catch (e) {
    console.warn("loadAgents:", e);
  }

  // Step 6: Load conversations
  try {
    await loadConversations();
  } catch (e) {
    console.warn("loadConversations:", e);
  }

  // Step 7: Auto-initialize branding for upgraded users.
  // Fresh installs have 0 conversations (only the seeded default agent).
  // Existing installs have conversations from prior use — skip onboarding for them.
  // Also check for existing localStorage settings as a secondary signal.
  const settings = useSettingsStore.getState();
  if (!settings.brandingInitialized) {
    const conversations = useConversationStore.getState().conversations;
    const hasExistingSettings = localStorage.getItem("openai_base_url") !== null
      || localStorage.getItem("openai_model_name") !== null;
    if (conversations.length > 0 || hasExistingSettings) {
      settings.initializeBranding(settings.companyName || "", settings.uiTheme || "org");
    }
  }

  // Step 8: Mark app as ready (onboarding gate can now make an informed decision).
  useSettingsStore.setState({ appReady: true });
}
