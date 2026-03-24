import { useSettingsStore } from "../stores/settingsStore";
import { useConversationStore } from "../stores/conversationStore";
import { useAgentStore } from "../stores/agentStore";
import { useTeamStore } from "../stores/teamStore";
import { useCronStore } from "../stores/cronStore";
import * as cmds from "./tauriCommands";
import { refreshDefaultManagerPersona } from "./commands/agentCommands";
import { emitLifecycleEvent } from "./lifecycleEvents";
import { registerHeartbeatLifecycle } from "./heartbeatService";
import { logger } from "./logger";

export async function initializeApp(): Promise<void> {
  emitLifecycleEvent({ type: "app:init" });

  const loadSettings = useSettingsStore.getState().loadSettings;
  const loadEnvDefaults = useSettingsStore.getState().loadEnvDefaults;
  const loadAgents = useAgentStore.getState().loadAgents;
  const loadConversations = useConversationStore.getState().loadConversations;

  // Step 1: Load settings (best-effort)
  try {
    loadSettings();
  } catch (e) {
    logger.warn("loadSettings:", e);
  }

  // Step 2: Load env defaults (best-effort)
  try {
    loadEnvDefaults();
  } catch (e) {
    logger.warn("loadEnvDefaults:", e);
  }

  // Step 3: Determine if this is a fresh install or existing install.
  // Fresh installs skip seeding here — it happens after onboarding completes.
  const settings = useSettingsStore.getState();
  const isFreshInstall = !settings.brandingInitialized && !([
    "openai_base_url", "openai_model_name",
    "thinking_enabled", "thinking_budget",
  ].some((key) => localStorage.getItem(key) !== null));

  if (!isFreshInstall) {
    // Existing install: seed with current locale (existing agents are untouched)
    try {
      await cmds.seedManagerAgent(settings.locale);
    } catch (e) {
      logger.warn("seedManagerAgent:", e);
    }
    // Refresh default manager persona with current locale
    // (upgrades old defaults, switches locale on untouched files, preserves user edits)
    try {
      await refreshDefaultManagerPersona(settings.locale);
    } catch (e) {
      logger.warn("refreshDefaultManagerPersona:", e);
    }
  }

  // Step 4: Sync agents from FS (best-effort)
  try {
    await cmds.syncAgentsFromFs();
  } catch (e) {
    logger.warn("syncAgentsFromFs:", e);
  }

  // Step 5: Load agents into store
  try {
    await loadAgents();
  } catch (e) {
    logger.warn("loadAgents:", e);
  }

  // Step 6: Load conversations
  try {
    await loadConversations();
  } catch (e) {
    logger.warn("loadConversations:", e);
  }

  // Step 6b: Load teams
  try {
    await useTeamStore.getState().loadTeams();
  } catch (e) {
    logger.warn("loadTeams:", e);
  }

  // Step 6c: Load cron jobs + setup event listeners
  try {
    await useCronStore.getState().loadJobs();
    await useCronStore.getState().setupListeners();
  } catch (e) {
    logger.warn("loadCronJobs:", e);
  }

  // Step 7: Auto-initialize branding for upgraded users.
  // Fresh installs have 0 conversations and no localStorage settings.
  // Existing installs have conversations or any previously saved settings.
  if (!settings.brandingInitialized) {
    const conversations = useConversationStore.getState().conversations;
    const hasExistingSettings = [
      "openai_base_url", "openai_model_name",
      "thinking_enabled", "thinking_budget",
    ].some((key) => localStorage.getItem(key) !== null);
    if (conversations.length > 0 || hasExistingSettings) {
      settings.initializeBranding(settings.companyName || "", settings.uiTheme || "org");
    }
  }

  // Step 8: Register heartbeat lifecycle (listens for session:start/end)
  registerHeartbeatLifecycle();

  // Step 9: Start consolidation recovery for pending conversations (non-blocking)
  useConversationStore.getState().initConsolidationRecovery();

  // Step 10: Mark app as ready (onboarding gate can now make an informed decision).
  useSettingsStore.setState({ appReady: true });

  emitLifecycleEvent({ type: "app:ready" });
}

/**
 * Seed the manager agent after onboarding completes (fresh install only).
 * Called from OnboardingScreen after the user selects language, theme, and company name.
 */
export async function seedManagerAfterOnboarding(locale: string): Promise<void> {
  const loadAgents = useAgentStore.getState().loadAgents;

  // seedManagerAgent is critical — let it throw so the caller can show an error
  await cmds.seedManagerAgent(locale);

  try {
    await cmds.syncAgentsFromFs();
  } catch (e) {
    logger.warn("syncAgentsFromFs:", e);
  }

  try {
    await loadAgents();
  } catch (e) {
    logger.warn("loadAgents:", e);
  }
}

/**
 * Seed selected template agents after onboarding (idempotent).
 * Uses existing createAgent + writeAgentFile commands.
 * On file-write failure, cleans up the DB row to prevent half-created agents.
 */
export async function seedTemplateAgents(
  templateKeys: string[],
  locale: string,
): Promise<void> {
  const { AGENT_TEMPLATES } = await import("../data/agentTemplates");
  const loadAgents = useAgentStore.getState().loadAgents;

  // Get existing agents to check for duplicates
  const existingAgents = useAgentStore.getState().agents;
  const existingFolders = new Set(existingAgents.map((a) => a.folder_name));

  // Get default tool config to write for each template
  let defaultToolConfigJson: string | null = null;
  try {
    defaultToolConfigJson = await cmds.getDefaultToolConfig();
  } catch (e) {
    logger.warn("getDefaultToolConfig:", e);
  }

  for (const key of templateKeys) {
    const template = AGENT_TEMPLATES.find((t) => t.key === key);
    if (!template) continue;

    // Idempotency: skip if folder already exists
    if (existingFolders.has(template.folderName)) continue;

    let createdAgent: { id: string } | null = null;
    try {
      const loc = (locale === "en" ? "en" : "ko") as "ko" | "en";
      createdAgent = await cmds.createAgent({
        folder_name: template.folderName,
        name: template.displayName[loc],
        description: template.description[loc],
      });

      const persona = template.personaFiles[loc];
      await cmds.writeAgentFile(template.folderName, "IDENTITY.md", persona.identity);
      await cmds.writeAgentFile(template.folderName, "SOUL.md", persona.soul);
      await cmds.writeAgentFile(template.folderName, "USER.md", persona.user);
      await cmds.writeAgentFile(template.folderName, "AGENTS.md", persona.agents);

      // Write default TOOL_CONFIG.json so templates have the same tools as manually created agents
      if (defaultToolConfigJson) {
        await cmds.writeAgentFile(template.folderName, "TOOL_CONFIG.json", defaultToolConfigJson);
      }

      // Track successful create for self-deduplication within this batch
      existingFolders.add(template.folderName);
    } catch (e) {
      // Clean up DB row if file writes failed, so retry won't skip a half-created agent
      if (createdAgent) {
        try {
          await cmds.deleteAgent(createdAgent.id);
        } catch (cleanupErr) {
          logger.warn(`Cleanup failed for ${key}:`, cleanupErr);
        }
      }
      logger.warn(`Template seed failed for ${key}:`, e);
    }
  }

  try {
    await cmds.syncAgentsFromFs();
  } catch (e) {
    logger.warn("syncAgentsFromFs:", e);
  }

  try {
    await loadAgents();
  } catch (e) {
    logger.warn("loadAgents:", e);
  }
}
