import { create } from "zustand";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_THINKING_BUDGET,
} from "../constants";
import { getEnvConfig } from "../services/tauriCommands";

// ── localStorage key constants ──────────────────────
const LS_API_KEY = "openai_api_key";
const LS_BASE_URL = "openai_base_url";
const LS_MODEL_NAME = "openai_model_name";
const LS_THINKING_ENABLED = "thinking_enabled";
const LS_THINKING_BUDGET = "thinking_budget";

interface SettingsState {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  isSettingsOpen: boolean;
  envLoaded: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  loadSettings: () => void;
  loadEnvDefaults: () => Promise<void>;
  waitForEnv: () => Promise<void>;
  saveSettings: (s: SettingValues) => void;
}

export interface SettingValues {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
}

function readSettings(): SettingValues {
  const raw = (key: string, fallback: string) =>
    localStorage.getItem(key) || fallback;

  const thinkingRaw = localStorage.getItem(LS_THINKING_ENABLED);
  const budgetRaw = localStorage.getItem(LS_THINKING_BUDGET);

  return {
    apiKey: raw(LS_API_KEY, ""),
    baseUrl: raw(LS_BASE_URL, DEFAULT_BASE_URL),
    modelName: raw(LS_MODEL_NAME, DEFAULT_MODEL),
    thinkingEnabled: thinkingRaw !== null ? thinkingRaw === "true" : true,
    thinkingBudget: budgetRaw ? (parseInt(budgetRaw, 10) || DEFAULT_THINKING_BUDGET) : DEFAULT_THINKING_BUDGET,
  };
}

const initial = readSettings();

// Promise that resolves once env defaults have been loaded (or failed).
let envReadyResolve: () => void;
const envReadyPromise = new Promise<void>((r) => { envReadyResolve = r; });

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  isSettingsOpen: false,
  envLoaded: false,

  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

  loadSettings: () => set(readSettings()),

  loadEnvDefaults: async () => {
    try {
      const env = await getEnvConfig();
      const updates: Partial<SettingValues> = {};

      // Only apply env fallback when localStorage truly has no entry (null).
      // This preserves intentional user clears (empty string saved).
      if (localStorage.getItem(LS_API_KEY) === null && env.api_key) {
        updates.apiKey = env.api_key;
      }
      if (localStorage.getItem(LS_BASE_URL) === null && env.base_url) {
        updates.baseUrl = env.base_url;
      }
      if (localStorage.getItem(LS_MODEL_NAME) === null && env.model) {
        updates.modelName = env.model;
      }

      set({ ...updates, envLoaded: true });
    } catch {
      // Tauri not available (e.g. tests) — silently ignore
      set({ envLoaded: true });
    } finally {
      envReadyResolve();
    }
  },

  waitForEnv: async () => {
    if (get().envLoaded) return;
    await envReadyPromise;
  },

  saveSettings: (s) => {
    const model = s.modelName || DEFAULT_MODEL;
    localStorage.setItem(LS_API_KEY, s.apiKey);
    localStorage.setItem(LS_BASE_URL, s.baseUrl);
    localStorage.setItem(LS_MODEL_NAME, model);
    localStorage.setItem(LS_THINKING_ENABLED, String(s.thinkingEnabled));
    localStorage.setItem(LS_THINKING_BUDGET, String(s.thinkingBudget));
    set({
      apiKey: s.apiKey,
      baseUrl: s.baseUrl,
      modelName: model,
      thinkingEnabled: s.thinkingEnabled,
      thinkingBudget: s.thinkingBudget,
      isSettingsOpen: false,
    });
  },
}));
