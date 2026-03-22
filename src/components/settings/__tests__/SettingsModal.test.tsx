import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SettingsPage from "../SettingsModal";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useNavigationStore } from "../../../stores/navigationStore";

vi.mock("../../../services/tauriCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauriCommands")>();
  return {
    ...actual,
    listModels: vi.fn().mockResolvedValue(["model-a", "model-b"]),
    checkApiHealth: vi.fn().mockResolvedValue({
      ok: true,
      base_url: "http://localhost:4000/v1",
      authorization_header_sent: true,
      api_key_preview: "sk-a...xyz",
      detail: "연결 성공 — 모델 2개 (예: model-a, model-b)",
    }),
  };
});

vi.mock("../../../services/commands/relayCommands", () => ({
  relayGetRelayUrl: vi.fn().mockResolvedValue(""),
  relaySetRelayUrl: vi.fn().mockResolvedValue(undefined),
}));

const initialSettings = useSettingsStore.getState();
const initialNav = useNavigationStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initialSettings, true);
  useNavigationStore.setState(initialNav, true);
});

describe("SettingsPage", () => {
  it("renders title when mainView is settings", async () => {
    useNavigationStore.setState({ mainView: "settings" });
    await act(async () => { render(<SettingsPage />); });
    expect(screen.getByText("환경 설정")).toBeInTheDocument();
  });

  it("general tab is active by default when API key exists", async () => {
    useSettingsStore.setState({ hasApiKey: true });
    useNavigationStore.setState({ mainView: "settings" });
    await act(async () => { render(<SettingsPage />); });
    const generalTab = screen.getByText("일반");
    expect(generalTab.className).toContain("active");
  });

  it("network tab is active by default when API key is missing", async () => {
    useSettingsStore.setState({ hasApiKey: false });
    useNavigationStore.setState({ mainView: "settings" });
    await act(async () => { render(<SettingsPage />); });
    const networkTab = screen.getByText("네트워크");
    expect(networkTab.className).toContain("active");
  });

  it("switching to thinking tab shows thinking controls", async () => {
    useNavigationStore.setState({ mainView: "settings" });
    await act(async () => { render(<SettingsPage />); });
    fireEvent.click(screen.getByText("추론 (Thinking)"));
    expect(screen.getByText("Thinking 모드 사용")).toBeInTheDocument();
    expect(screen.getByText("Budget Tokens")).toBeInTheDocument();
  });

  it("clicking cancel goes back to previous view", async () => {
    useNavigationStore.setState({ mainView: "settings", previousView: "vault" });
    await act(async () => { render(<SettingsPage />); });
    fireEvent.click(screen.getByText("취소"));
    expect(useNavigationStore.getState().mainView).toBe("vault");
  });

  it("clicking save calls saveSettings and goes back", async () => {
    useNavigationStore.setState({ mainView: "settings", previousView: "team" });
    useSettingsStore.setState({ hasApiKey: true });
    await act(async () => { render(<SettingsPage />); });
    const saveButtons = screen.getAllByText("저장");
    const footerSave = saveButtons.find((btn) => btn.classList.contains("btn-primary"))!;
    await act(async () => { fireEvent.click(footerSave); });
    await vi.waitFor(() => {
      expect(useNavigationStore.getState().mainView).toBe("team");
    });
  });

  it("clears stale settingsError on open", async () => {
    useSettingsStore.setState({ settingsError: "old error" });
    useNavigationStore.setState({ mainView: "settings" });
    await act(async () => { render(<SettingsPage />); });
    expect(useSettingsStore.getState().settingsError).toBeNull();
  });

  it("runs API health check and shows result", async () => {
    useNavigationStore.setState({ mainView: "settings" });
    useSettingsStore.setState({
      hasApiKey: true,
      baseUrl: "http://localhost:4000/v1",
      modelName: "model-a",
      thinkingEnabled: true,
      thinkingBudget: 4096,
    });

    await act(async () => { render(<SettingsPage />); });
    await act(async () => { fireEvent.click(screen.getByText("네트워크")); });
    await act(async () => { fireEvent.click(screen.getByText("연결 확인")); });

    expect(await screen.findByText("연결 성공")).toBeInTheDocument();
  });
});
