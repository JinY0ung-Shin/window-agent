import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../settingsStore";
import { useNavigationStore } from "../navigationStore";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_THINKING_BUDGET,
} from "../../constants";

const mockedInvoke = vi.mocked(invoke);
const initialState = useSettingsStore.getState();
const initialNav = useNavigationStore.getState();

/** Default AppSettings response from the backend. */
const defaultAppSettings = {
  model_name: DEFAULT_MODEL,
  thinking_enabled: false,
  thinking_budget: DEFAULT_THINKING_BUDGET,
  ui_theme: "org",
  company_name: "",
  branding_initialized: false,
  locale: "ko",
};

/**
 * Helper to mock invoke calls for loadEnvDefaults.
 * Order: migrate_frontend_settings, get_app_settings, get_env_config, has_api_key, has_stored_key
 */
function mockLoadEnvDefaults(opts: {
  appSettings?: Record<string, unknown>;
  envConfig?: { base_url: string | null; model: string | null };
  hasApiKey?: boolean;
  hasStoredKey?: boolean;
} = {}) {
  const {
    appSettings = defaultAppSettings,
    envConfig = { base_url: null, model: null },
    hasApiKey = false,
    hasStoredKey = false,
  } = opts;

  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "migrate_frontend_settings": return undefined;
      case "get_app_settings": return appSettings;
      case "get_env_config": return envConfig;
      case "has_api_key": return hasApiKey;
      case "has_stored_key": return hasStoredKey;
      default: return undefined;
    }
  });
}

/**
 * Helper to mock invoke calls for saveSettings.
 * Order: set_api_config, has_api_key, has_stored_key, set_app_settings
 */
function mockSaveSettings(opts: {
  hasApiKey?: boolean;
  hasStoredKey?: boolean;
} = {}) {
  const { hasApiKey = true, hasStoredKey = false } = opts;

  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "set_api_config": return undefined;
      case "has_api_key": return hasApiKey;
      case "has_stored_key": return hasStoredKey;
      case "set_app_settings": return undefined;
      default: return undefined;
    }
  });
}

beforeEach(() => {
  useSettingsStore.setState(initialState, true);
  useNavigationStore.setState(initialNav, true);
  localStorage.clear();
  mockedInvoke.mockReset();
});

describe("settingsStore", () => {
  it("has correct default values", () => {
    const s = useSettingsStore.getState();
    expect(s.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(s.modelName).toBe(DEFAULT_MODEL);
    expect(s.thinkingEnabled).toBe(true);
    expect(s.thinkingBudget).toBe(DEFAULT_THINKING_BUDGET);
    expect(s.hasApiKey).toBe(false);
  });

  it("loadSettings reads from localStorage", () => {
    localStorage.setItem("openai_base_url", "http://localhost:3000");
    localStorage.setItem("openai_model_name", "gpt-4");
    localStorage.setItem("thinking_enabled", "false");
    localStorage.setItem("thinking_budget", "2048");

    useSettingsStore.getState().loadSettings();
    const s = useSettingsStore.getState();

    expect(s.baseUrl).toBe("http://localhost:3000");
    expect(s.modelName).toBe("gpt-4");
    expect(s.thinkingEnabled).toBe(false);
    expect(s.thinkingBudget).toBe(2048);
  });

  it("loadSettings uses defaults when localStorage is empty", () => {
    useSettingsStore.getState().loadSettings();
    const s = useSettingsStore.getState();
    expect(s.modelName).toBe(DEFAULT_MODEL);
    expect(s.thinkingEnabled).toBe(true);
  });

  it("saveSettings writes non-secret settings to localStorage", async () => {
    mockSaveSettings({ hasApiKey: true });

    await useSettingsStore.getState().saveSettings({
      apiKey: "new-key",
      baseUrl: "http://new-url",
      modelName: "gpt-4o",
      thinkingEnabled: false,
      thinkingBudget: 8192,
    });

    // API key should NOT be in localStorage
    expect(localStorage.getItem("openai_api_key")).toBeNull();

    // Non-secret settings should be in localStorage
    expect(localStorage.getItem("openai_base_url")).toBe("http://new-url");

    const s = useSettingsStore.getState();
    expect(s.baseUrl).toBe("http://new-url");
    expect(s.thinkingBudget).toBe(8192);
    expect(s.hasApiKey).toBe(true);
    expect(useNavigationStore.getState().mainView).toBe("chat");
  });

  it("saveSettings uses default model when modelName is empty", async () => {
    mockSaveSettings({ hasApiKey: false });

    await useSettingsStore.getState().saveSettings({
      apiKey: "",
      baseUrl: "u",
      modelName: "",
      thinkingEnabled: true,
      thinkingBudget: DEFAULT_THINKING_BUDGET,
    });

    expect(useSettingsStore.getState().modelName).toBe(DEFAULT_MODEL);
  });

  it("saveSettings keeps existing key when apiKey is blank", async () => {
    mockSaveSettings({ hasApiKey: true });

    await useSettingsStore.getState().saveSettings({
      apiKey: "",
      baseUrl: "http://proxy.local/v1",
      modelName: "gpt-4o",
      thinkingEnabled: true,
      thinkingBudget: DEFAULT_THINKING_BUDGET,
    });

    expect(mockedInvoke).toHaveBeenCalledWith("set_api_config", {
      request: { base_url: "http://proxy.local/v1" },
    });
  });

  it("saveSettings clears the stored key when requested", async () => {
    mockSaveSettings({ hasApiKey: true });

    await useSettingsStore.getState().saveSettings({
      apiKey: "",
      clearApiKey: true,
      baseUrl: "http://proxy.local/v1",
      modelName: "gpt-4o",
      thinkingEnabled: true,
      thinkingBudget: DEFAULT_THINKING_BUDGET,
    });

    expect(mockedInvoke).toHaveBeenCalledWith("set_api_config", {
      request: { api_key: "", base_url: "http://proxy.local/v1" },
    });
  });

  it("loadSettings handles corrupt localStorage value (uses defaults)", () => {
    localStorage.setItem("thinking_budget", "not-a-number");
    localStorage.setItem("thinking_enabled", "garbage");

    useSettingsStore.getState().loadSettings();
    const s = useSettingsStore.getState();

    expect(s.thinkingEnabled).toBe(false);
    expect(s.thinkingBudget).toBe(4096);
  });

  it("saveSettings persists all non-secret fields correctly", async () => {
    mockSaveSettings({ hasApiKey: true });

    await useSettingsStore.getState().saveSettings({
      apiKey: "my-api-key",
      baseUrl: "http://example.com/v1",
      modelName: "claude-3",
      thinkingEnabled: true,
      thinkingBudget: 16384,
    });

    expect(localStorage.getItem("openai_base_url")).toBe("http://example.com/v1");

    const s = useSettingsStore.getState();
    expect(s.baseUrl).toBe("http://example.com/v1");
    expect(s.modelName).toBe("claude-3");
    expect(s.thinkingEnabled).toBe(true);
    expect(s.thinkingBudget).toBe(16384);
    expect(useNavigationStore.getState().mainView).toBe("chat");
  });

  describe("loadEnvDefaults", () => {
    it("hydrates from backend AppSettings and applies env base_url override", async () => {
      mockLoadEnvDefaults({
        appSettings: {
          ...defaultAppSettings,
          model_name: "env-model",
        },
        envConfig: { base_url: "http://env-url/v1", model: "env-model" },
        hasApiKey: true,
      });

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.baseUrl).toBe("http://env-url/v1");
      expect(s.modelName).toBe("env-model");
      expect(s.hasApiKey).toBe(true);
      expect(s.envLoaded).toBe(true);
    });

    it("does NOT override base_url when localStorage has a value", async () => {
      localStorage.setItem("openai_base_url", "http://local-url");

      mockLoadEnvDefaults({
        envConfig: { base_url: "http://env-url/v1", model: "env-model" },
        hasApiKey: false,
      });

      useSettingsStore.getState().loadSettings();
      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      // base_url kept from localStorage (env override skipped)
      expect(s.baseUrl).toBe("http://local-url");
      // model_name comes from backend AppSettings (source of truth)
      expect(s.modelName).toBe(DEFAULT_MODEL);
    });

    it("sets envLoaded even when env has no values", async () => {
      mockLoadEnvDefaults({
        envConfig: { base_url: null, model: null },
        hasApiKey: false,
      });

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.envLoaded).toBe(true);
      expect(s.hasApiKey).toBe(false);
    });

    it("sets envLoaded even when Tauri invoke fails", async () => {
      mockedInvoke.mockRejectedValue(new Error("Tauri not available"));

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.envLoaded).toBe(true);
    });
  });
});
