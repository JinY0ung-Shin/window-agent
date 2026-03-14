import { create } from "zustand";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_THINKING_BUDGET,
} from "../constants";
import { getEnvConfig, hasApiKey as checkApiKey, setApiConfig } from "../services/tauriCommands";

// ── localStorage key constants (non-secret settings only) ──
const LS_BASE_URL = "openai_base_url";
const LS_MODEL_NAME = "openai_model_name";
const LS_THINKING_ENABLED = "thinking_enabled";
const LS_THINKING_BUDGET = "thinking_budget";

interface SettingsState {
  hasApiKey: boolean;
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
  saveSettings: (s: SettingValues) => Promise<void>;
}

export interface SettingValues {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
}

function readNonSecretSettings() {
  const raw = (key: string, fallback: string) =>
    localStorage.getItem(key) || fallback;

  const thinkingRaw = localStorage.getItem(LS_THINKING_ENABLED);
  const budgetRaw = localStorage.getItem(LS_THINKING_BUDGET);

  return {
    baseUrl: raw(LS_BASE_URL, DEFAULT_BASE_URL),
    modelName: raw(LS_MODEL_NAME, DEFAULT_MODEL),
    thinkingEnabled: thinkingRaw !== null ? thinkingRaw === "true" : true,
    thinkingBudget: budgetRaw ? (parseInt(budgetRaw, 10) || DEFAULT_THINKING_BUDGET) : DEFAULT_THINKING_BUDGET,
  };
}

const initial = readNonSecretSettings();

// Promise that resolves once env defaults have been loaded (or failed).
let envReadyResolve: () => void;
const envReadyPromise = new Promise<void>((r) => { envReadyResolve = r; });

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  hasApiKey: false,
  isSettingsOpen: false,
  envLoaded: false,

  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

  loadSettings: () => set(readNonSecretSettings()),

  loadEnvDefaults: async () => {
    try {
      // Load non-secret env defaults
      const env = await getEnvConfig();

      const updates: Partial<{ baseUrl: string; modelName: string }> = {};

      if (localStorage.getItem(LS_BASE_URL) === null && env.base_url) {
        updates.baseUrl = env.base_url;
      }
      if (localStorage.getItem(LS_MODEL_NAME) === null && env.model) {
        updates.modelName = env.model;
      }

      // Check if backend has an API key (from .env or previous set_api_config)
      const apiKeyExists = await checkApiKey();

      set({ ...updates, hasApiKey: apiKeyExists, envLoaded: true });
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

  saveSettings: async (s) => {
    const model = s.modelName || DEFAULT_MODEL;

    // Sync API config to backend first, then update frontend state.
    // api_key is only sent when non-empty (user actively typed a new key).
    // Empty field = "no change" to avoid accidental key clearing.
    const apiUpdate: { api_key?: string; base_url: string } = {
      base_url: s.baseUrl,
    };
    if (s.apiKey) {
      apiUpdate.api_key = s.apiKey;
    }
    try {
      await setApiConfig(apiUpdate);
      const keyExists = await checkApiKey();
      set({ hasApiKey: keyExists });
    } catch (e) {
      console.error("Failed to set API config:", e);
    }

    // Persist non-secret settings in localStorage
    localStorage.setItem(LS_BASE_URL, s.baseUrl);
    localStorage.setItem(LS_MODEL_NAME, model);
    localStorage.setItem(LS_THINKING_ENABLED, String(s.thinkingEnabled));
    localStorage.setItem(LS_THINKING_BUDGET, String(s.thinkingBudget));
    set({
      baseUrl: s.baseUrl,
      modelName: model,
      thinkingEnabled: s.thinkingEnabled,
      thinkingBudget: s.thinkingBudget,
      isSettingsOpen: false,
    });
  },
}));
