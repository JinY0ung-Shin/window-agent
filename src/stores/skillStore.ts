import { create } from "zustand";
import type { SkillMetadata } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { estimateTokens } from "../services/tokenEstimator";
import { i18n } from "../i18n";
import { logger } from "../services/logger";

export const SKILL_TOKEN_HARD_CAP = 3000;

interface SkillState {
  availableSkills: SkillMetadata[];
  activeSkillBodies: Record<string, string>;
  activeSkillNames: string[];
  activeSkillTokens: number;
  catalogPrompt: string;
  isLoading: boolean;
  /** Tracks which folder is currently loaded to guard against stale async results */
  _loadedFolder: string | null;
  /** Monotonically increasing version to detect stale async loads */
  _loadVersion: number;

  loadSkills: (folderName: string) => Promise<void>;
  activateSkill: (folderName: string, skillName: string, convId?: string) => Promise<boolean>;
  deactivateSkill: (skillName: string, convId?: string) => Promise<boolean>;
  restoreActiveSkills: (folderName: string, activeNames: string[]) => Promise<void>;
  getSkillsPromptSection: () => string;
  clear: () => void;
}

function buildCatalogPrompt(skills: SkillMetadata[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return `[AVAILABLE SKILLS]\n${lines.join("\n")}\n${i18n.t("agent:skills.availableSkillsHint")}`;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  availableSkills: [],
  activeSkillBodies: {},
  activeSkillNames: [],
  activeSkillTokens: 0,
  catalogPrompt: "",
  isLoading: false,
  _loadedFolder: null,
  _loadVersion: 0,

  loadSkills: async (folderName) => {
    // Bump version so stale async results from prior loads are discarded
    const version = get()._loadVersion + 1;
    set({ isLoading: true, _loadVersion: version, _loadedFolder: folderName });
    try {
      const skills = await cmds.listSkills(folderName);
      // Stale guard: only apply if this is still the most recent load
      if (get()._loadVersion !== version) return;
      set({
        availableSkills: skills,
        catalogPrompt: buildCatalogPrompt(skills),
        isLoading: false,
      });
    } catch (e) {
      if (get()._loadVersion !== version) return;
      logger.debug("Failed to load skills", e);
      set({ availableSkills: [], catalogPrompt: "", isLoading: false });
    }
  },

  activateSkill: async (folderName, skillName, convId?) => {
    const { activeSkillNames, activeSkillBodies, activeSkillTokens } = get();

    // Duplicate guard
    if (activeSkillNames.includes(skillName)) return true;

    try {
      const skillContent = await cmds.readSkill(folderName, skillName);
      const bodyTokens = estimateTokens(skillContent.body);

      if (activeSkillTokens + bodyTokens > SKILL_TOKEN_HARD_CAP) {
        return false;
      }

      const newNames = [...activeSkillNames, skillName];
      const newBodies = { ...activeSkillBodies, [skillName]: skillContent.body };
      const newTokens = activeSkillTokens + bodyTokens;

      // Persist first, then update local state (rollback-safe)
      if (convId) {
        try {
          await cmds.updateConversationSkills(convId, newNames);
        } catch (e) {
          logger.warn("Failed to persist skill activation:", e);
          // Don't update local state if DB persistence failed
          return false;
        }
      }

      set({
        activeSkillNames: newNames,
        activeSkillBodies: newBodies,
        activeSkillTokens: newTokens,
      });

      return true;
    } catch (e) {
      logger.debug("Skill activation failed", e);
      return false;
    }
  },

  deactivateSkill: async (skillName, convId?) => {
    const { activeSkillNames, activeSkillBodies } = get();

    const body = activeSkillBodies[skillName];
    const bodyTokens = body ? estimateTokens(body) : 0;

    const newNames = activeSkillNames.filter((n) => n !== skillName);
    const newBodies = { ...activeSkillBodies };
    delete newBodies[skillName];

    // Persist first, then update local state (rollback-safe)
    if (convId) {
      try {
        await cmds.updateConversationSkills(convId, newNames);
      } catch (e) {
        logger.warn("Failed to persist skill deactivation:", e);
        return false; // Don't update local state if DB persistence failed
      }
    }

    set({
      activeSkillNames: newNames,
      activeSkillBodies: newBodies,
      activeSkillTokens: get().activeSkillTokens - bodyTokens,
    });
    return true;
  },

  restoreActiveSkills: async (folderName, activeNames) => {
    const version = get()._loadVersion;
    const bodies: Record<string, string> = {};
    const restored: string[] = [];
    let totalTokens = 0;

    for (const name of activeNames) {
      // Stale guard: abort if a newer load/clear happened
      if (get()._loadVersion !== version) return;
      try {
        const skillContent = await cmds.readSkill(folderName, name);
        const bodyTokens = estimateTokens(skillContent.body);

        if (totalTokens + bodyTokens > SKILL_TOKEN_HARD_CAP) {
          break;
        }

        bodies[name] = skillContent.body;
        restored.push(name);
        totalTokens += bodyTokens;
      } catch (e) {
        logger.warn(`Skill "${name}" not found, skipping restore`, e);
      }
    }

    // Final stale guard before applying state
    if (get()._loadVersion !== version) return;
    set({
      activeSkillNames: restored,
      activeSkillBodies: bodies,
      activeSkillTokens: totalTokens,
    });
  },

  getSkillsPromptSection: () => {
    const { availableSkills, catalogPrompt, activeSkillNames, activeSkillBodies } = get();
    if (availableSkills.length === 0) return "";

    let result = catalogPrompt;

    if (activeSkillNames.length > 0) {
      const activeSection = activeSkillNames
        .map((name) => `--- ${name} ---\n${activeSkillBodies[name] ?? ""}\n--- end ---`)
        .join("\n");
      result += `\n\n[ACTIVE SKILLS]\n${activeSection}`;
    }

    return result;
  },

  clear: () =>
    set((state) => ({
      availableSkills: [],
      activeSkillBodies: {},
      activeSkillNames: [],
      activeSkillTokens: 0,
      catalogPrompt: "",
      isLoading: false,
      _loadedFolder: null,
      _loadVersion: state._loadVersion + 1, // Invalidate in-flight loads
    })),
}));
