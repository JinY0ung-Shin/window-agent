import { create } from "zustand";

interface SettingsState {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  loadSettings: () => void;
  saveSettings: (apiKey: string, baseUrl: string, modelName: string) => void;
}

const DEFAULT_API_KEY = "sk-YlEqf0acfNgeKYJ7rLQ6rrE9jkI6ik0Bx3RqDxzBgDcSM";
const DEFAULT_BASE_URL = "http://192.168.0.105:8317/v1";
const DEFAULT_MODEL = "gpt-5.3-codex";

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  modelName: DEFAULT_MODEL,
  isSettingsOpen: false,

  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

  loadSettings: () => {
    const savedKey = localStorage.getItem("openai_api_key") || DEFAULT_API_KEY;
    const savedBaseUrl = localStorage.getItem("openai_base_url") || DEFAULT_BASE_URL;
    const savedModelName = localStorage.getItem("openai_model_name") || DEFAULT_MODEL;

    if (!localStorage.getItem("openai_api_key")) {
      localStorage.setItem("openai_api_key", DEFAULT_API_KEY);
    }

    set({
      apiKey: savedKey,
      baseUrl: savedBaseUrl,
      modelName: savedModelName,
    });
  },

  saveSettings: (apiKey, baseUrl, modelName) => {
    const model = modelName || DEFAULT_MODEL;
    localStorage.setItem("openai_api_key", apiKey);
    localStorage.setItem("openai_base_url", baseUrl);
    localStorage.setItem("openai_model_name", model);
    set({ apiKey, baseUrl, modelName: model, isSettingsOpen: false });
  },
}));
