import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../settingsStore";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_THINKING_BUDGET,
} from "../../constants";

const mockedInvoke = vi.mocked(invoke);
const initialState = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initialState, true);
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
    expect(s.isSettingsOpen).toBe(false);
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
    // Mock: set_api_config then has_api_key
    mockedInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);

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
    expect(localStorage.getItem("thinking_enabled")).toBe("false");
    expect(localStorage.getItem("thinking_budget")).toBe("8192");

    const s = useSettingsStore.getState();
    expect(s.baseUrl).toBe("http://new-url");
    expect(s.thinkingBudget).toBe(8192);
    expect(s.isSettingsOpen).toBe(false);
    expect(s.hasApiKey).toBe(true);
  });

  it("saveSettings uses default model when modelName is empty", async () => {
    mockedInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(false);

    await useSettingsStore.getState().saveSettings({
      apiKey: "",
      baseUrl: "u",
      modelName: "",
      thinkingEnabled: true,
      thinkingBudget: DEFAULT_THINKING_BUDGET,
    });

    expect(useSettingsStore.getState().modelName).toBe(DEFAULT_MODEL);
  });

  it("setIsSettingsOpen toggles modal state", () => {
    useSettingsStore.getState().setIsSettingsOpen(true);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

    useSettingsStore.getState().setIsSettingsOpen(false);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
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
    mockedInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);

    await useSettingsStore.getState().saveSettings({
      apiKey: "my-api-key",
      baseUrl: "http://example.com/v1",
      modelName: "claude-3",
      thinkingEnabled: true,
      thinkingBudget: 16384,
    });

    expect(localStorage.getItem("openai_base_url")).toBe("http://example.com/v1");
    expect(localStorage.getItem("openai_model_name")).toBe("claude-3");
    expect(localStorage.getItem("thinking_enabled")).toBe("true");
    expect(localStorage.getItem("thinking_budget")).toBe("16384");

    const s = useSettingsStore.getState();
    expect(s.baseUrl).toBe("http://example.com/v1");
    expect(s.modelName).toBe("claude-3");
    expect(s.thinkingEnabled).toBe(true);
    expect(s.thinkingBudget).toBe(16384);
    expect(s.isSettingsOpen).toBe(false);
  });

  describe("loadEnvDefaults", () => {
    it("applies env values when localStorage is absent and checks API key", async () => {
      // First call: get_env_config, second call: has_api_key
      mockedInvoke
        .mockResolvedValueOnce({ base_url: "http://env-url/v1", model: "env-model" })
        .mockResolvedValueOnce(true);

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.baseUrl).toBe("http://env-url/v1");
      expect(s.modelName).toBe("env-model");
      expect(s.hasApiKey).toBe(true);
      expect(s.envLoaded).toBe(true);
    });

    it("does NOT override when localStorage has values", async () => {
      localStorage.setItem("openai_base_url", "http://local-url");
      localStorage.setItem("openai_model_name", "local-model");

      mockedInvoke
        .mockResolvedValueOnce({ base_url: "http://env-url/v1", model: "env-model" })
        .mockResolvedValueOnce(false);

      useSettingsStore.getState().loadSettings();
      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.baseUrl).toBe("http://local-url");
      expect(s.modelName).toBe("local-model");
    });

    it("sets envLoaded even when env has no values", async () => {
      mockedInvoke
        .mockResolvedValueOnce({ base_url: null, model: null })
        .mockResolvedValueOnce(false);

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
