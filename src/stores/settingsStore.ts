import { create } from "zustand";

interface SettingsState {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  loadSettings: () => void;
  saveSettings: (s: SettingValues) => void;
}

interface SettingValues {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
}

const DEFAULT_API_KEY = "sk-YlEqf0acfNgeKYJ7rLQ6rrE9jkI6ik0Bx3RqDxzBgDcSM";
const DEFAULT_BASE_URL = "http://192.168.0.105:8317/v1";
const DEFAULT_MODEL = "gpt-5.3-codex";
const DEFAULT_THINKING_BUDGET = 4096;

const readLocal = (key: string, fallback: string) =>
  localStorage.getItem(key) || fallback;

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: readLocal("openai_api_key", DEFAULT_API_KEY),
  baseUrl: readLocal("openai_base_url", DEFAULT_BASE_URL),
  modelName: readLocal("openai_model_name", DEFAULT_MODEL),
  thinkingEnabled: readLocal("thinking_enabled", "true") === "true",
  thinkingBudget: parseInt(readLocal("thinking_budget", String(DEFAULT_THINKING_BUDGET)), 10),
  isSettingsOpen: false,

  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

  loadSettings: () => {
    const savedKey = localStorage.getItem("openai_api_key") || DEFAULT_API_KEY;
    const savedBaseUrl = localStorage.getItem("openai_base_url") || DEFAULT_BASE_URL;
    const savedModelName = localStorage.getItem("openai_model_name") || DEFAULT_MODEL;
    const savedThinking = localStorage.getItem("thinking_enabled");
    const savedBudget = localStorage.getItem("thinking_budget");

    if (!localStorage.getItem("openai_api_key")) {
      localStorage.setItem("openai_api_key", DEFAULT_API_KEY);
    }

    set({
      apiKey: savedKey,
      baseUrl: savedBaseUrl,
      modelName: savedModelName,
      thinkingEnabled: savedThinking !== null ? savedThinking === "true" : true,
      thinkingBudget: savedBudget ? parseInt(savedBudget, 10) : DEFAULT_THINKING_BUDGET,
    });
  },

  saveSettings: (s) => {
    const model = s.modelName || DEFAULT_MODEL;
    localStorage.setItem("openai_api_key", s.apiKey);
    localStorage.setItem("openai_base_url", s.baseUrl);
    localStorage.setItem("openai_model_name", model);
    localStorage.setItem("thinking_enabled", String(s.thinkingEnabled));
    localStorage.setItem("thinking_budget", String(s.thinkingBudget));
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
