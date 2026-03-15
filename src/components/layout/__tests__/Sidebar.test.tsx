import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "../Sidebar";
import { useConversationStore } from "../../../stores/conversationStore";
import { useSettingsStore } from "../../../stores/settingsStore";

vi.mock("../../../services/tauriCommands");

const initialConvState = useConversationStore.getState();
const initialSettingsState = useSettingsStore.getState();

beforeEach(() => {
  useConversationStore.setState(initialConvState, true);
  useSettingsStore.setState(initialSettingsState, true);
});

describe("Sidebar", () => {
  it("renders app title", () => {
    render(<Sidebar />);
    expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
  });

  it("renders new chat button", () => {
    render(<Sidebar />);
    expect(screen.getByText("새 대화")).toBeInTheDocument();
  });

  it("renders conversation list", () => {
    useConversationStore.setState({
      conversations: [
        { id: "1", title: "대화 A", agent_id: "a1", created_at: "", updated_at: "" },
        { id: "2", title: "대화 B", agent_id: "a1", created_at: "", updated_at: "" },
      ],
    });
    render(<Sidebar />);
    expect(screen.getByText("대화 A")).toBeInTheDocument();
    expect(screen.getByText("대화 B")).toBeInTheDocument();
  });

  it("clicking new chat calls createNewConversation", () => {
    const spy = vi.fn();
    useConversationStore.setState({ createNewConversation: spy });
    render(<Sidebar />);
    fireEvent.click(screen.getByText("새 대화"));
    expect(spy).toHaveBeenCalled();
  });

  it("clicking conversation calls selectConversation", () => {
    const spy = vi.fn();
    useConversationStore.setState({
      conversations: [{ id: "c1", title: "Test Conv", agent_id: "a1", created_at: "", updated_at: "" }],
      selectConversation: spy,
    });
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Test Conv"));
    expect(spy).toHaveBeenCalledWith("c1");
  });

  it("clicking settings opens settings modal", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("설정"));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });
});
