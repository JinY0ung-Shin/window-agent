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
  // If agents exist but branding was never initialized, this is an existing install
  // upgrading to the new version — skip onboarding and use defaults.
  const settings = useSettingsStore.getState();
  if (!settings.brandingInitialized) {
    const agents = useAgentStore.getState().agents;
    if (agents.length > 0) {
      settings.initializeBranding(settings.companyName || "", settings.uiTheme || "org");
    }
  }
}
