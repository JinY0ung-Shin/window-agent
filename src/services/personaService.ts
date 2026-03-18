import type { Agent, PersonaFiles } from "./types";
import * as cmds from "./tauriCommands";
import { useSettingsStore } from "../stores/settingsStore";
import { i18n } from "../i18n";

export const PERSONA_FILE_NAMES: Array<keyof PersonaFiles> = [
  "identity",
  "soul",
  "user",
  "agents",
];

export const FILE_NAME_MAP: Record<keyof PersonaFiles, string> = {
  identity: "IDENTITY.md",
  soul: "SOUL.md",
  user: "USER.md",
  agents: "AGENTS.md",
};

// In-memory cache to avoid re-reading persona files on every message send.
const personaCache = new Map<string, PersonaFiles>();

/**
 * Read all 4 persona .md files for an agent from disk (cached).
 */
export async function readPersonaFiles(folderName: string): Promise<PersonaFiles> {
  const cached = personaCache.get(folderName);
  if (cached) return cached;

  const files: PersonaFiles = { identity: "", soul: "", user: "", agents: "" };

  await Promise.all(
    PERSONA_FILE_NAMES.map(async (key) => {
      try {
        files[key] = await cmds.readAgentFile(folderName, FILE_NAME_MAP[key]);
      } catch {
        files[key] = "";
      }
    }),
  );

  personaCache.set(folderName, files);
  return files;
}

/**
 * Write all 4 persona .md files for an agent to disk.
 * Invalidates the cache for the folder.
 */
export async function writePersonaFiles(
  folderName: string,
  files: PersonaFiles,
): Promise<void> {
  await Promise.all(
    PERSONA_FILE_NAMES.map((key) =>
      cmds.writeAgentFile(folderName, FILE_NAME_MAP[key], files[key]),
    ),
  );
  personaCache.set(folderName, { ...files });
}

/**
 * Invalidate cached persona files for a folder (e.g. after bootstrap writes).
 */
export function invalidatePersonaCache(folderName?: string): void {
  if (folderName) {
    personaCache.delete(folderName);
  } else {
    personaCache.clear();
  }
}

/**
 * Assemble 4 persona files into a single system prompt string.
 */
export function assembleSystemPrompt(files: PersonaFiles): string {
  const sections: string[] = [];

  const identity = files.identity.trim();
  const soul = files.soul.trim();
  const user = files.user.trim();
  const agents = files.agents.trim();

  if (identity) sections.push(`[IDENTITY]\n${identity}`);
  if (soul) sections.push(`[SOUL]\n${soul}`);
  if (user) sections.push(`[USER]\n${user}`);
  if (agents) sections.push(`[AGENTS]\n${agents}`);

  return sections.join("\n\n---\n\n");
}

/**
 * For the manager agent: inject the dynamic agent list into the assembled prompt.
 * Also replaces {{company_name}} placeholders and appends [SYSTEM CONTEXT] with enabled tools.
 */
export function assembleManagerPrompt(
  files: PersonaFiles,
  allAgents: Agent[],
  companyName: string = "",
  enabledToolNames: string[] = [],
): string {
  const effectiveCompanyName = companyName.trim() || i18n.t("glossary:defaultCompanyName");
  let basePrompt = assembleSystemPrompt(files).replace(
    /\{\{company_name\}\}/g,
    effectiveCompanyName,
  );

  const otherAgents = allAgents.filter((a) => !a.is_default);
  if (otherAgents.length === 0) {
    basePrompt += "\n\n---\n\n[REGISTERED AGENTS]\nNo registered agents.";
  } else {
    const agentList = otherAgents
      .map((a) => `- **${a.name}**: ${a.description || "(no description)"}`)
      .join("\n");
    basePrompt += `\n\n---\n\n[REGISTERED AGENTS]\n${agentList}`;
  }

  if (enabledToolNames.length > 0) {
    basePrompt += `\n\n---\n\n[SYSTEM CONTEXT]\n${i18n.t("prompts:systemContext.availableTools", { tools: enabledToolNames.join(", ") })}`;
  }

  return basePrompt;
}

/**
 * Get effective settings for an agent, falling back to global settings.
 */
export function getEffectiveSettings(agent: Agent) {
  const global = useSettingsStore.getState();

  return {
    model: agent.model ?? global.modelName,
    temperature: agent.temperature,
    thinkingEnabled:
      agent.thinking_enabled !== null ? agent.thinking_enabled : global.thinkingEnabled,
    thinkingBudget: agent.thinking_budget ?? global.thinkingBudget,
  };
}
