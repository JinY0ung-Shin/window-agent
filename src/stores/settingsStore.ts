import { create } from "zustand";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_THINKING_BUDGET,
} from "../constants";
import {
  getEnvConfig,
  hasApiKey as checkApiKey,
  hasStoredKey as checkStoredKey,
  setApiConfig,
  getAppSettings,
  setAppSettings,
  migrateFrontendSettings,
} from "../services/tauriCommands";
import { refreshDefaultManagerPersona } from "../services/commands/agentCommands";
import { useNavigationStore } from "./navigationStore";
import { i18n, syncThemeVars, type Locale } from "../i18n";
import { logger } from "../services/logger";
import { toErrorMessage } from "../utils/errorUtils";
import { listen } from "@tauri-apps/api/event";

export type UITheme = "classic" | "org";

// ── localStorage key constants (sync cache — backend is source of truth) ──
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
  maxToolIterations: number;
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
  // Branding (optional — included when saving from settings modal)
  companyName?: string;
  uiTheme?: UITheme;
}

/**
 * Read non-secret settings from localStorage (synchronous cache).
 * These may be stale — overwritten by backend hydration in loadEnvDefaults().
 */
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

/** Write AppSettings fields to localStorage cache. */
function cacheToLocalStorage(s: {
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  uiTheme: string;
  companyName: string;
  brandingInitialized: boolean;
  locale: string;
  networkEnabled?: boolean;
}) {
  localStorage.setItem(LS_MODEL_NAME, s.modelName);
  localStorage.setItem(LS_THINKING_ENABLED, String(s.thinkingEnabled));
  localStorage.setItem(LS_THINKING_BUDGET, String(s.thinkingBudget));
  localStorage.setItem(LS_UI_THEME, s.uiTheme);
  localStorage.setItem(LS_COMPANY_NAME, s.companyName);
  localStorage.setItem(LS_BRANDING_INITIALIZED, String(s.brandingInitialized));
  localStorage.setItem(LS_LOCALE, s.locale);
  // network_enabled is read by NetworkToggleSection for consent-gate logic
  if (s.networkEnabled !== undefined) {
    localStorage.setItem("network_enabled", String(s.networkEnabled));
  }
}

const initial = readNonSecretSettings();

// Promise that resolves once env defaults have been loaded (or failed).
let envReadyResolve: () => void;
const envReadyPromise = new Promise<void>((r) => { envReadyResolve = r; });

// Subscribe to backend settings:changed event for reactive sync.
listen<{
  model_name: string;
  thinking_enabled: boolean;
  thinking_budget: number;
  ui_theme: string;
  company_name: string;
  branding_initialized: boolean;
  locale: string;
  network_enabled: boolean;
  max_tool_iterations: number;
}>("settings:changed", (event) => {
  const s = event.payload;
  const prev = useSettingsStore.getState();
  const updates = {
    modelName: s.model_name,
    thinkingEnabled: s.thinking_enabled,
    thinkingBudget: s.thinking_budget,
    uiTheme: s.ui_theme as UITheme,
    companyName: s.company_name,
    brandingInitialized: s.branding_initialized,
    locale: s.locale as Locale,
    maxToolIterations: s.max_tool_iterations,
  };
  cacheToLocalStorage({
    ...updates,
    uiTheme: s.ui_theme,
    locale: s.locale,
    networkEnabled: s.network_enabled,
  });
  useSettingsStore.setState(updates);
  // Sync i18n/theme singletons when values change
  if (s.locale !== prev.locale) {
    i18n.changeLanguage(s.locale);
  }
  if (s.ui_theme !== prev.uiTheme) {
    syncThemeVars(i18n, s.ui_theme as UITheme);
  }
}).catch(() => {
  // Silently ignore in test environments where Tauri is not available
});

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  hasApiKey: false,
  hasStoredKey: false,
  envLoaded: false,
  settingsError: null,
  maxToolIterations: 10,
  appReady: false,

  loadSettings: () => set(readNonSecretSettings()),

  loadEnvDefaults: async () => {
    try {
      // 1. Migrate localStorage → backend store (one-time, idempotent)
      try {
        await migrateFrontendSettings({
          [LS_MODEL_NAME]: localStorage.getItem(LS_MODEL_NAME),
          [LS_THINKING_ENABLED]: localStorage.getItem(LS_THINKING_ENABLED),
          [LS_THINKING_BUDGET]: localStorage.getItem(LS_THINKING_BUDGET),
          [LS_UI_THEME]: localStorage.getItem(LS_UI_THEME),
          [LS_COMPANY_NAME]: localStorage.getItem(LS_COMPANY_NAME),
          [LS_BRANDING_INITIALIZED]: localStorage.getItem(LS_BRANDING_INITIALIZED),
          [LS_LOCALE]: localStorage.getItem(LS_LOCALE),
        });
      } catch {
        // Migration failure is non-fatal
      }

      // 2. Hydrate from backend (authoritative source)
      const [appSettings, env] = await Promise.all([
        getAppSettings(),
        getEnvConfig(),
      ]);

      // base_url is still managed by ApiState, apply env override if localStorage is empty
      const baseUrlUpdates: Partial<{ baseUrl: string }> = {};
      if (localStorage.getItem(LS_BASE_URL) === null && env.base_url) {
        baseUrlUpdates.baseUrl = env.base_url;
      }

      // Update localStorage cache with authoritative backend values
      cacheToLocalStorage({
        modelName: appSettings.model_name,
        thinkingEnabled: appSettings.thinking_enabled,
        thinkingBudget: appSettings.thinking_budget,
        uiTheme: appSettings.ui_theme,
        companyName: appSettings.company_name,
        brandingInitialized: appSettings.branding_initialized,
        locale: appSettings.locale,
      });

      // Check if backend has API access configured + actual key stored
      const apiKeyExists = await checkApiKey();
      const storedKeyExists = await checkStoredKey();

      const prev = get();
      set({
        ...baseUrlUpdates,
        modelName: appSettings.model_name,
        thinkingEnabled: appSettings.thinking_enabled,
        thinkingBudget: appSettings.thinking_budget,
        uiTheme: appSettings.ui_theme as UITheme,
        companyName: appSettings.company_name,
        brandingInitialized: appSettings.branding_initialized,
        locale: appSettings.locale as Locale,
        maxToolIterations: appSettings.max_tool_iterations,
        hasApiKey: apiKeyExists,
        hasStoredKey: storedKeyExists,
        envLoaded: true,
      });

      // Sync i18n/theme singletons if backend values differ from initial cache
      if (appSettings.locale !== prev.locale) {
        i18n.changeLanguage(appSettings.locale);
      }
      if (appSettings.ui_theme !== prev.uiTheme) {
        syncThemeVars(i18n, appSettings.ui_theme as UITheme);
      }
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

    // 1. Sync API config (key + base_url) to backend
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

    // 2. Sync ALL non-secret settings to backend in a single call (avoids race conditions).
    //    AppSettings::set() emits settings:changed → auto-updates Zustand + localStorage cache.
    try {
      const patch: Record<string, unknown> = {
        model_name: model,
        thinking_enabled: s.thinkingEnabled,
        thinking_budget: s.thinkingBudget,
      };
      // Include branding if provided (from settings modal save)
      if (s.companyName !== undefined) patch.company_name = s.companyName;
      if (s.uiTheme !== undefined) patch.ui_theme = s.uiTheme;
      await setAppSettings(patch);
    } catch (e) {
      logger.error("Failed to save app settings:", e);
      set({ settingsError: i18n.t("common:errors.settingsSaveFailed", { error: toErrorMessage(e) }) });
      return;
    }

    // 3. Update local state immediately (settings:changed event provides additional sync).
    //    base_url is managed by ApiState, not AppSettings — cache manually.
    localStorage.setItem(LS_BASE_URL, s.baseUrl);
    const stateUpdate: Record<string, unknown> = {
      baseUrl: s.baseUrl,
      modelName: model,
      thinkingEnabled: s.thinkingEnabled,
      thinkingBudget: s.thinkingBudget,
      settingsError: null,
    };
    if (s.companyName !== undefined) stateUpdate.companyName = s.companyName;
    if (s.uiTheme !== undefined) {
      stateUpdate.uiTheme = s.uiTheme;
      syncThemeVars(i18n, s.uiTheme);
    }
    set(stateUpdate as Partial<SettingsState>);
    useNavigationStore.getState().goBack();
  },

  // ── Branding actions ──
  // AppSettings::set() emits settings:changed → auto-updates localStorage cache + Zustand.
  // Side-effects (i18n, theme sync) are applied immediately for responsiveness.
  setUITheme: (theme) => {
    syncThemeVars(i18n, theme);
    set({ uiTheme: theme });
    setAppSettings({ ui_theme: theme }).catch((e) =>
      logger.warn("Failed to persist ui_theme:", e),
    );
  },

  setCompanyName: (name) => {
    set({ companyName: name });
    setAppSettings({ company_name: name }).catch((e) =>
      logger.warn("Failed to persist company_name:", e),
    );
  },

  setLocale: (locale) => {
    i18n.changeLanguage(locale);
    syncThemeVars(i18n, get().uiTheme);
    set({ locale });
    setAppSettings({ locale }).catch((e) =>
      logger.warn("Failed to persist locale:", e),
    );
    // Refresh default manager persona files asynchronously (don't block UI)
    refreshDefaultManagerPersona(locale).catch((e) =>
      logger.warn("refreshDefaultManagerPersona:", e),
    );
  },

  initializeBranding: (companyName, theme = "org", locale = "ko") => {
    // Apply side-effects immediately
    i18n.changeLanguage(locale);
    syncThemeVars(i18n, theme);
    set({ companyName, uiTheme: theme, locale, brandingInitialized: true });
    // Persist to backend (source of truth) — settings:changed event will update localStorage cache.
    setAppSettings({
      company_name: companyName,
      ui_theme: theme,
      locale,
      branding_initialized: true,
    }).catch((e) => logger.warn("Failed to persist branding:", e));
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
