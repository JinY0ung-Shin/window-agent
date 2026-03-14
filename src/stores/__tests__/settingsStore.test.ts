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
  });

  it("loadSettings reads from localStorage", () => {
    localStorage.setItem("openai_api_key", "test-key");
    localStorage.setItem("openai_base_url", "http://localhost:3000");
    localStorage.setItem("openai_model_name", "gpt-4");
    localStorage.setItem("thinking_enabled", "false");
    localStorage.setItem("thinking_budget", "2048");

    useSettingsStore.getState().loadSettings();
    const s = useSettingsStore.getState();

    expect(s.apiKey).toBe("test-key");
    expect(s.baseUrl).toBe("http://localhost:3000");
    expect(s.modelName).toBe("gpt-4");
    expect(s.thinkingEnabled).toBe(false);
    expect(s.thinkingBudget).toBe(2048);
  });

  it("loadSettings uses defaults when localStorage is empty", () => {
    useSettingsStore.getState().loadSettings();
    const s = useSettingsStore.getState();
    expect(s.apiKey).toBe("");
    expect(s.modelName).toBe(DEFAULT_MODEL);
    expect(s.thinkingEnabled).toBe(true);
  });

  it("saveSettings writes to localStorage and updates state", () => {
    useSettingsStore.getState().saveSettings({
      apiKey: "new-key",
      baseUrl: "http://new-url",
      modelName: "gpt-4o",
      thinkingEnabled: false,
      thinkingBudget: 8192,
    });

    expect(localStorage.getItem("openai_api_key")).toBe("new-key");
    expect(localStorage.getItem("thinking_enabled")).toBe("false");
    expect(localStorage.getItem("thinking_budget")).toBe("8192");

    const s = useSettingsStore.getState();
    expect(s.apiKey).toBe("new-key");
    expect(s.thinkingBudget).toBe(8192);
    expect(s.isSettingsOpen).toBe(false);
  });

  it("saveSettings uses default model when modelName is empty", () => {
    useSettingsStore.getState().saveSettings({
      apiKey: "k",
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
    // thinking_budget is not valid JSON/number — parseInt will return NaN,
    // but the store uses `budgetRaw ? parseInt(budgetRaw, 10) : DEFAULT_THINKING_BUDGET`
    // so a non-numeric string will give NaN. We verify the store still loads without crashing.
    localStorage.setItem("thinking_budget", "not-a-number");
    localStorage.setItem("thinking_enabled", "garbage");

    useSettingsStore.getState().loadSettings();
    const s = useSettingsStore.getState();

    // "garbage" !== "true" so thinkingEnabled should be false
    expect(s.thinkingEnabled).toBe(false);
    // corrupt value falls back to DEFAULT_THINKING_BUDGET
    expect(s.thinkingBudget).toBe(4096);
  });

  it("saveSettings persists all fields correctly", () => {
    useSettingsStore.getState().saveSettings({
      apiKey: "my-api-key",
      baseUrl: "http://example.com/v1",
      modelName: "claude-3",
      thinkingEnabled: true,
      thinkingBudget: 16384,
    });

    expect(localStorage.getItem("openai_api_key")).toBe("my-api-key");
    expect(localStorage.getItem("openai_base_url")).toBe("http://example.com/v1");
    expect(localStorage.getItem("openai_model_name")).toBe("claude-3");
    expect(localStorage.getItem("thinking_enabled")).toBe("true");
    expect(localStorage.getItem("thinking_budget")).toBe("16384");

    const s = useSettingsStore.getState();
    expect(s.apiKey).toBe("my-api-key");
    expect(s.baseUrl).toBe("http://example.com/v1");
    expect(s.modelName).toBe("claude-3");
    expect(s.thinkingEnabled).toBe(true);
    expect(s.thinkingBudget).toBe(16384);
    expect(s.isSettingsOpen).toBe(false);
  });

  describe("loadEnvDefaults", () => {
    it("applies env values when localStorage is absent", async () => {
      mockedInvoke.mockResolvedValue({
        api_key: "env-key",
        base_url: "http://env-url/v1",
        model: "env-model",
      });

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.apiKey).toBe("env-key");
      expect(s.baseUrl).toBe("http://env-url/v1");
      expect(s.modelName).toBe("env-model");
      expect(s.envLoaded).toBe(true);
    });

    it("does NOT override when localStorage has values", async () => {
      localStorage.setItem("openai_api_key", "local-key");
      localStorage.setItem("openai_base_url", "http://local-url");
      localStorage.setItem("openai_model_name", "local-model");

      mockedInvoke.mockResolvedValue({
        api_key: "env-key",
        base_url: "http://env-url/v1",
        model: "env-model",
      });

      useSettingsStore.getState().loadSettings();
      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.apiKey).toBe("local-key");
      expect(s.baseUrl).toBe("http://local-url");
      expect(s.modelName).toBe("local-model");
    });

    it("preserves user's intentional empty value in localStorage", async () => {
      // User explicitly saved an empty API key
      localStorage.setItem("openai_api_key", "");

      mockedInvoke.mockResolvedValue({
        api_key: "env-key",
        base_url: null,
        model: null,
      });

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      // Should NOT override — localStorage entry exists (even if empty)
      expect(s.apiKey).toBe("");
    });

    it("sets envLoaded even when env has no values", async () => {
      mockedInvoke.mockResolvedValue({
        api_key: null,
        base_url: null,
        model: null,
      });

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.envLoaded).toBe(true);
      expect(s.apiKey).toBe("");
    });

    it("sets envLoaded even when Tauri invoke fails", async () => {
      mockedInvoke.mockRejectedValue(new Error("Tauri not available"));

      await useSettingsStore.getState().loadEnvDefaults();
      const s = useSettingsStore.getState();

      expect(s.envLoaded).toBe(true);
    });
  });
});
