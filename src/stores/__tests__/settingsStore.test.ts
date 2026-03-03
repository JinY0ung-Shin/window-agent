import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settingsStore";

const initialState = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initialState, true);
  localStorage.clear();
});

describe("settingsStore", () => {
  it("has correct default values", () => {
    const s = useSettingsStore.getState();
    expect(s.baseUrl).toBe("http://192.168.0.105:8317/v1");
    expect(s.modelName).toBe("gpt-5.3-codex");
    expect(s.thinkingEnabled).toBe(true);
    expect(s.thinkingBudget).toBe(4096);
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
    expect(s.apiKey).toBe("sk-YlEqf0acfNgeKYJ7rLQ6rrE9jkI6ik0Bx3RqDxzBgDcSM");
    expect(s.modelName).toBe("gpt-5.3-codex");
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
      thinkingBudget: 4096,
    });

    expect(useSettingsStore.getState().modelName).toBe("gpt-5.3-codex");
  });

  it("setIsSettingsOpen toggles modal state", () => {
    useSettingsStore.getState().setIsSettingsOpen(true);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

    useSettingsStore.getState().setIsSettingsOpen(false);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });
});
