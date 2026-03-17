import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SettingsModal from "../SettingsModal";
import { useSettingsStore } from "../../../stores/settingsStore";

vi.mock("../../../services/tauriCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauriCommands")>();
  return {
    ...actual,
    listModels: vi.fn().mockResolvedValue(["model-a", "model-b"]),
    checkApiHealth: vi.fn().mockResolvedValue({
      ok: true,
      base_url: "http://localhost:4000/v1",
      models_url: "http://localhost:4000/v1/models",
      completions_url: "http://localhost:4000/v1/chat/completions",
      model: "model-a",
      authorization_header_sent: true,
      thinking_enabled: true,
      models_check: { ok: true, detail: "ok" },
      completion_check: { ok: true, detail: "ok" },
    }),
  };
});

const initialState = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initialState, true);
});

describe("SettingsModal", () => {
  it("does not render when isSettingsOpen is false", () => {
    useSettingsStore.setState({ isSettingsOpen: false });
    const { container } = render(<SettingsModal />);
    expect(container.innerHTML).toBe("");
  });

  it("renders when isSettingsOpen is true", async () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    await act(async () => { render(<SettingsModal />); });
    expect(screen.getByText("환경 설정")).toBeInTheDocument();
  });

  it("general tab is active by default", async () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    await act(async () => { render(<SettingsModal />); });
    const generalTab = screen.getByText("일반");
    expect(generalTab.className).toContain("active");
  });

  it("switching to thinking tab shows thinking controls", async () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    await act(async () => { render(<SettingsModal />); });
    fireEvent.click(screen.getByText("추론 (Thinking)"));
    expect(screen.getByText("Thinking 모드 사용")).toBeInTheDocument();
    expect(screen.getByText("Budget Tokens")).toBeInTheDocument();
  });

  it("clicking cancel closes modal", async () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    await act(async () => { render(<SettingsModal />); });
    fireEvent.click(screen.getByText("취소"));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it("clicking save calls saveSettings and closes modal", async () => {
    useSettingsStore.setState({ isSettingsOpen: true, hasApiKey: true });
    await act(async () => { render(<SettingsModal />); });
    await act(async () => { fireEvent.click(screen.getByText("저장")); });
    await vi.waitFor(() => {
      expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    });
  });

  it("runs API health check and shows result", async () => {
    useSettingsStore.setState({
      isSettingsOpen: true,
      hasApiKey: true,
      baseUrl: "http://localhost:4000/v1",
      modelName: "model-a",
      thinkingEnabled: true,
      thinkingBudget: 4096,
    });

    await act(async () => { render(<SettingsModal />); });
    await act(async () => { fireEvent.click(screen.getByText("API Health Check")); });

    expect(await screen.findByText("API 연결 정상")).toBeInTheDocument();
    expect(screen.getByText(/Authorization 헤더: 전송됨/)).toBeInTheDocument();
  });
});
