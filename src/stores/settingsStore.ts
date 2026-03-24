import { create } from "zustand";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_THINKING_BUDGET,
} from "../constants";
import { getEnvConfig, hasApiKey as checkApiKey, hasStoredKey as checkStoredKey, setApiConfig } from "../services/tauriCommands";
import { refreshDefaultManagerPersona } from "../services/commands/agentCommands";
import { useNavigationStore } from "./navigationStore";
import { i18n, type Locale } from "../i18n";
import { logger } from "../services/logger";
import { toErrorMessage } from "../utils/errorUtils";

export type UITheme = "classic" | "org";

// ── localStorage key constants (non-secret settings only) ──
const LS_BASE_URL = "openai_base_url";
const LS_MODEL_NAME = "openai_model_name";
const LS_THINKING_ENABLED = "thinking_enabled";
const LS_THINKING_BUDGET = "thinking_budget";
const LS_UI_THEME = "ui_theme";
const LS_COMPANY_NAME = "company_name";
const LS_BRANDING_INITIALIZED = "branding_initialized";
const LS_LOCALE = "locale";

interface SettingsState {
  hasApiKey: boolean;      // API access configured (key OR custom URL)
  hasStoredKey: boolean;   // Actual API key string stored
  baseUrl: string;
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  envLoaded: boolean;
  settingsError: string | null;
  // ── Branding ──
  uiTheme: UITheme;
  companyName: string;
  brandingInitialized: boolean;
  locale: Locale;
  appReady: boolean;
  loadSettings: () => void;
  loadEnvDefaults: () => Promise<void>;
  waitForEnv: () => Promise<void>;
  saveSettings: (s: SettingValues) => Promise<void>;
  // ── Branding actions ──
  setUITheme: (theme: UITheme) => void;
  setCompanyName: (name: string) => void;
  setLocale: (locale: Locale) => void;
  initializeBranding: (companyName: string, theme?: UITheme, locale?: Locale) => void;
  // ── Onboarding API setup ──
  saveOnboardingApiConfig: (apiKey: string, baseUrl: string) => Promise<void>;
}

export interface SettingValues {
  apiKey: string;
  clearApiKey?: boolean;
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
    uiTheme: (localStorage.getItem(LS_UI_THEME) || "org") as UITheme,
    companyName: localStorage.getItem(LS_COMPANY_NAME) || "",
    brandingInitialized: localStorage.getItem(LS_BRANDING_INITIALIZED) === "true",
    locale: (localStorage.getItem(LS_LOCALE) || "ko") as Locale,
  };
}

const initial = readNonSecretSettings();

// Promise that resolves once env defaults have been loaded (or failed).
let envReadyResolve: () => void;
const envReadyPromise = new Promise<void>((r) => { envReadyResolve = r; });

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  hasApiKey: false,
  hasStoredKey: false,
  envLoaded: false,
  settingsError: null,
  appReady: false,

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

      // Check if backend has API access configured + actual key stored
      const apiKeyExists = await checkApiKey();
      const storedKeyExists = await checkStoredKey();

      set({ ...updates, hasApiKey: apiKeyExists, hasStoredKey: storedKeyExists, envLoaded: true });
    } catch (e) {
      logger.debug("Env defaults unavailable (expected in tests)", e);
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
    // Empty field = "no change" unless the user explicitly requested clearing it.
    const apiUpdate: { api_key?: string; base_url: string } = {
      base_url: s.baseUrl,
    };
    if (s.clearApiKey) {
      apiUpdate.api_key = "";
    } else if (s.apiKey) {
      apiUpdate.api_key = s.apiKey;
    }
    try {
      await setApiConfig(apiUpdate);
      const keyExists = await checkApiKey();
      const storedExists = await checkStoredKey();
      set({ hasApiKey: keyExists, hasStoredKey: storedExists });
    } catch (e) {
      logger.error("Failed to set API config:", e);
      set({ settingsError: i18n.t("common:errors.settingsSaveFailed", { error: toErrorMessage(e) }) });
      return;
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
      settingsError: null,
    });
    useNavigationStore.getState().goBack();
  },

  // ── Branding actions ──
  setUITheme: (theme) => {
    localStorage.setItem(LS_UI_THEME, theme);
    set({ uiTheme: theme });
  },

  setCompanyName: (name) => {
    localStorage.setItem(LS_COMPANY_NAME, name);
    set({ companyName: name });
  },

  setLocale: (locale) => {
    localStorage.setItem(LS_LOCALE, locale);
    i18n.changeLanguage(locale);
    set({ locale });
    // Refresh default manager persona files asynchronously (don't block UI)
    refreshDefaultManagerPersona(locale).catch((e) =>
      logger.warn("refreshDefaultManagerPersona:", e),
    );
  },

  initializeBranding: (companyName, theme = "org", locale = "ko") => {
    localStorage.setItem(LS_COMPANY_NAME, companyName);
    localStorage.setItem(LS_UI_THEME, theme);
    localStorage.setItem(LS_LOCALE, locale);
    localStorage.setItem(LS_BRANDING_INITIALIZED, "true");
    i18n.changeLanguage(locale);
    set({ companyName, uiTheme: theme, locale, brandingInitialized: true });
  },

  saveOnboardingApiConfig: async (apiKey, baseUrl) => {
    const apiUpdate: { api_key?: string; base_url: string } = { base_url: baseUrl };
    if (apiKey) apiUpdate.api_key = apiKey;
    try {
      await setApiConfig(apiUpdate);
      const keyExists = await checkApiKey();
      const storedExists = await checkStoredKey();
      localStorage.setItem(LS_BASE_URL, baseUrl);
      set({ baseUrl, hasApiKey: keyExists, hasStoredKey: storedExists, settingsError: null });
    } catch (e) {
      logger.error("Onboarding API config failed:", e);
      throw e;
    }
  },
}));
