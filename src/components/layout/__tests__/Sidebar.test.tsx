import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "../Sidebar";
import { useConversationStore } from "../../../stores/conversationStore";
import { useAgentStore } from "../../../stores/agentStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useBootstrapStore } from "../../../stores/bootstrapStore";

vi.mock("../../../services/tauriCommands");

const initialConvState = useConversationStore.getState();
const initialAgentState = useAgentStore.getState();
const initialSettingsState = useSettingsStore.getState();
const initialBootstrapState = useBootstrapStore.getState();

const makeAgent = (overrides: Partial<any> = {}) => ({
  id: "a1",
  folder_name: "test-agent",
  name: "Test Agent",
  avatar: null,
  description: "A test agent",
  model: null,
  temperature: null,
  thinking_enabled: null,
  thinking_budget: null,
  is_default: false,
  sort_order: 0,
  created_at: "",
  updated_at: "",
  ...overrides,
});

beforeEach(() => {
  useConversationStore.setState(initialConvState, true);
  useAgentStore.setState(initialAgentState, true);
  useSettingsStore.setState(initialSettingsState, true);
  useBootstrapStore.setState(initialBootstrapState, true);
});

describe("Sidebar (DM-style)", () => {
  it("renders app title", () => {
    render(<Sidebar />);
    expect(screen.getByText("우리 회사")).toBeInTheDocument();
  });

  it("renders 'new agent' button instead of 'new chat'", () => {
    render(<Sidebar />);
    expect(screen.getByText("채용하기")).toBeInTheDocument();
    expect(screen.queryByText("새 대화")).not.toBeInTheDocument();
  });

  it("renders agent list (not conversation list)", () => {
    useAgentStore.setState({
      agents: [
        makeAgent({ id: "a1", name: "Agent Alpha" }),
        makeAgent({ id: "a2", name: "Agent Beta" }),
      ],
    });
    render(<Sidebar />);
    expect(screen.getByText("Agent Alpha")).toBeInTheDocument();
    expect(screen.getByText("Agent Beta")).toBeInTheDocument();
  });

  it("deduplicates: one agent with multiple conversations shows once", () => {
    useAgentStore.setState({
      agents: [makeAgent({ id: "a1", name: "Agent Alpha" })],
    });
    useConversationStore.setState({
      conversations: [
        { id: "c1", title: "Conv 1", agent_id: "a1", created_at: "", updated_at: "2024-01-02" },
        { id: "c2", title: "Conv 2", agent_id: "a1", created_at: "", updated_at: "2024-01-01" },
      ],
    });
    render(<Sidebar />);
    const agentItems = screen.getAllByText("Agent Alpha");
    expect(agentItems).toHaveLength(1);
  });

  it("sorts agents with recent conversations first", () => {
    useAgentStore.setState({
      agents: [
        makeAgent({ id: "a1", name: "Old Agent", sort_order: 0 }),
        makeAgent({ id: "a2", name: "Active Agent", sort_order: 1 }),
      ],
    });
    useConversationStore.setState({
      conversations: [
        { id: "c1", title: "Conv", agent_id: "a2", created_at: "", updated_at: "2024-01-02" },
      ],
    });
    render(<Sidebar />);
    const items = screen.getAllByRole("generic").filter(
      (el) => el.classList.contains("conversation-item"),
    );
    // Active Agent (has conv) should come before Old Agent (no conv)
    expect(items.length).toBe(2);
  });

  it("clicking agent calls openAgentChat", () => {
    const spy = vi.fn();
    useAgentStore.setState({
      agents: [makeAgent({ id: "a1", name: "Test Agent" })],
    });
    useConversationStore.setState({ openAgentChat: spy });
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Test Agent"));
    expect(spy).toHaveBeenCalledWith("a1");
  });

  it("highlights active agent by currentConversationId", () => {
    useAgentStore.setState({
      agents: [makeAgent({ id: "a1", name: "Test Agent" })],
    });
    useConversationStore.setState({
      currentConversationId: "c1",
      conversations: [
        { id: "c1", title: "Conv", agent_id: "a1", created_at: "", updated_at: "" },
      ],
    });
    render(<Sidebar />);
    const item = screen.getByText("Test Agent").closest(".menu-item");
    expect(item?.classList.contains("active")).toBe(true);
  });

  it("highlights active agent by selectedAgentId when no conversation", () => {
    useAgentStore.setState({
      agents: [makeAgent({ id: "a1", name: "Test Agent" })],
      selectedAgentId: "a1",
    });
    render(<Sidebar />);
    const item = screen.getByText("Test Agent").closest(".menu-item");
    expect(item?.classList.contains("active")).toBe(true);
  });

  it("shows clear-chat button only for agents with conversations", () => {
    useAgentStore.setState({
      agents: [
        makeAgent({ id: "a1", name: "Has Conv" }),
        makeAgent({ id: "a2", name: "No Conv" }),
      ],
    });
    useConversationStore.setState({
      conversations: [
        { id: "c1", title: "Conv", agent_id: "a1", created_at: "", updated_at: "" },
      ],
    });
    render(<Sidebar />);
    const deleteButtons = screen.getAllByTitle("대화 초기화");
    expect(deleteButtons).toHaveLength(1);
  });

  it("clear-chat calls clearAgentChat", () => {
    const spy = vi.fn();
    useAgentStore.setState({
      agents: [makeAgent({ id: "a1", name: "Test Agent" })],
    });
    useConversationStore.setState({
      conversations: [
        { id: "c1", title: "Conv", agent_id: "a1", created_at: "", updated_at: "" },
      ],
      clearAgentChat: spy,
    });
    render(<Sidebar />);
    fireEvent.click(screen.getByTitle("대화 초기화"));
    expect(spy).toHaveBeenCalledWith("a1");
  });

  it("clicking settings opens settings modal", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("설정"));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });
});
