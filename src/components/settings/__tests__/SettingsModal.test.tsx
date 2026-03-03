import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsModal from "../SettingsModal";
import { useSettingsStore } from "../../../stores/settingsStore";

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

  it("renders when isSettingsOpen is true", () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    render(<SettingsModal />);
    expect(screen.getByText("환경 설정")).toBeInTheDocument();
  });

  it("general tab is active by default", () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    render(<SettingsModal />);
    const generalTab = screen.getByText("일반");
    expect(generalTab.className).toContain("active");
  });

  it("switching to thinking tab shows thinking controls", () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    render(<SettingsModal />);
    fireEvent.click(screen.getByText("추론 (Thinking)"));
    expect(screen.getByText("Thinking 모드 사용")).toBeInTheDocument();
    expect(screen.getByText("Budget Tokens")).toBeInTheDocument();
  });

  it("clicking cancel closes modal", () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    render(<SettingsModal />);
    fireEvent.click(screen.getByText("취소"));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it("clicking save calls saveSettings and closes modal", () => {
    useSettingsStore.setState({ isSettingsOpen: true, apiKey: "old-key" });
    render(<SettingsModal />);
    fireEvent.click(screen.getByText("저장"));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });
});
