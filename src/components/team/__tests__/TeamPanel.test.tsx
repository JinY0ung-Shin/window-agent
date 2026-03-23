import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TeamPanel from "../TeamPanel";
import { useTeamStore } from "../../../stores/teamStore";
import { useAgentStore } from "../../../stores/agentStore";
import { useConversationStore } from "../../../stores/conversationStore";
import { useMessageStore } from "../../../stores/messageStore";
import { useNavigationStore } from "../../../stores/navigationStore";

vi.mock("../../../services/commands/teamCommands");
vi.mock("../../../services/commands/agentCommands");
vi.mock("../../../services/commands/conversationCommands");
vi.mock("../TeamEditor", () => ({
  default: () => <div data-testid="team-editor">Team Editor</div>,
}));

const initialTeamState = useTeamStore.getState();
const initialAgentState = useAgentStore.getState();
const initialConvState = useConversationStore.getState();
const initialMsgState = useMessageStore.getState();
const initialNavState = useNavigationStore.getState();

beforeEach(() => {
  useTeamStore.setState(initialTeamState, true);
  useAgentStore.setState(initialAgentState, true);
  useConversationStore.setState(initialConvState, true);
  useConversationStore.setState({ loadConversations: vi.fn() });
  useMessageStore.setState(initialMsgState, true);
  useNavigationStore.setState(initialNavState, true);
});

const mockTeams = [
  {
    id: "team-1",
    name: "Alpha Team",
    description: "First team",
    leader_agent_id: "agent-1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "team-2",
    name: "Beta Team",
    description: "",
    leader_agent_id: "agent-2",
    created_at: "2024-01-02T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
];

const mockAgents = [
  { id: "agent-1", folder_name: "alpha", name: "Alpha Agent", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" },
  { id: "agent-2", folder_name: "beta", name: "Beta Agent", avatar: "https://example.com/avatar.png", description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" },
];

describe("TeamPanel", () => {
  it("renders empty state when no teams", () => {
    useTeamStore.setState({
      teams: [],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn(),
    });
    useAgentStore.setState({ agents: [], loadAgents: vi.fn() });

    render(<TeamPanel />);
    // noTeams => "아직 팀이 없습니다. 새 팀을 만들어 보세요."
    expect(screen.getByText("아직 팀이 없습니다. 새 팀을 만들어 보세요.")).toBeInTheDocument();
  });

  it("renders team cards when teams exist", () => {
    useTeamStore.setState({
      teams: mockTeams,
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    render(<TeamPanel />);
    expect(screen.getByText("Alpha Team")).toBeInTheDocument();
    expect(screen.getByText("Beta Team")).toBeInTheDocument();
  });

  it("shows team description when present", () => {
    useTeamStore.setState({
      teams: mockTeams,
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    render(<TeamPanel />);
    expect(screen.getByText("First team")).toBeInTheDocument();
  });

  it("resolves agent name from agent store", () => {
    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    render(<TeamPanel />);
    expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
  });

  it("shows 'Unknown' for unresolved agent", () => {
    useTeamStore.setState({
      teams: [{
        ...mockTeams[0],
        leader_agent_id: "nonexistent-agent",
      }],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    render(<TeamPanel />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("calls loadTeams and loadAgents on mount", () => {
    const loadTeams = vi.fn();
    const loadAgents = vi.fn();
    useTeamStore.setState({ teams: [], loadTeams, getTeamDetail: vi.fn() });
    useAgentStore.setState({ agents: [], loadAgents });

    render(<TeamPanel />);
    expect(loadTeams).toHaveBeenCalled();
    expect(loadAgents).toHaveBeenCalled();
  });

  it("shows delete confirmation on trash button click", () => {
    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    const { container } = render(<TeamPanel />);

    const deleteBtn = container.querySelector(".team-card-delete")!;
    fireEvent.click(deleteBtn);

    // common:delete => "삭제", team cancel => "취소"
    expect(screen.getByText("삭제")).toBeInTheDocument();
    expect(screen.getByText("취소")).toBeInTheDocument();
  });

  it("cancels delete confirmation", () => {
    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    const { container } = render(<TeamPanel />);

    const deleteBtn = container.querySelector(".team-card-delete")!;
    fireEvent.click(deleteBtn);

    // cancel => "취소"
    const cancelBtn = screen.getByText("취소");
    fireEvent.click(cancelBtn);

    // Confirmation should disappear, edit/delete buttons return
    expect(screen.queryByText("삭제")).not.toBeInTheDocument();
    expect(container.querySelector(".team-card-delete")).toBeInTheDocument();
  });

  it("calls deleteTeam on confirm delete", () => {
    const deleteTeam = vi.fn();
    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      deleteTeam,
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    const { container } = render(<TeamPanel />);

    const deleteBtn = container.querySelector(".team-card-delete")!;
    fireEvent.click(deleteBtn);

    // common:delete => "삭제"
    const confirmBtn = screen.getByText("삭제");
    fireEvent.click(confirmBtn);

    expect(deleteTeam).toHaveBeenCalledWith("team-1");
  });

  it("opens team editor on create button click", () => {
    const openTeamEditor = vi.fn();
    useTeamStore.setState({
      teams: [],
      loadTeams: vi.fn(),
      openTeamEditor,
      isTeamEditorOpen: false,
      getTeamDetail: vi.fn(),
    });
    useAgentStore.setState({ agents: [], loadAgents: vi.fn() });

    render(<TeamPanel />);
    // newTeam => "새 팀"
    const createBtn = screen.getByText("새 팀");
    fireEvent.click(createBtn);
    expect(openTeamEditor).toHaveBeenCalledWith();
  });

  it("opens team editor for editing on settings button click", () => {
    const openTeamEditor = vi.fn();
    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      openTeamEditor,
      isTeamEditorOpen: false,
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    const { container } = render(<TeamPanel />);

    const editBtn = container.querySelector(".team-card-edit")!;
    fireEvent.click(editBtn);
    expect(openTeamEditor).toHaveBeenCalledWith("team-1");
  });

  it("renders TeamEditor when isTeamEditorOpen is true", () => {
    useTeamStore.setState({
      teams: [],
      loadTeams: vi.fn(),
      isTeamEditorOpen: true,
      getTeamDetail: vi.fn(),
    });
    useAgentStore.setState({ agents: [], loadAgents: vi.fn() });

    render(<TeamPanel />);
    expect(screen.getByTestId("team-editor")).toBeInTheDocument();
  });

  it("does not render TeamEditor when isTeamEditorOpen is false", () => {
    useTeamStore.setState({
      teams: [],
      loadTeams: vi.fn(),
      isTeamEditorOpen: false,
      getTeamDetail: vi.fn(),
    });
    useAgentStore.setState({ agents: [], loadAgents: vi.fn() });

    render(<TeamPanel />);
    expect(screen.queryByTestId("team-editor")).not.toBeInTheDocument();
  });

  it("shows team conversations when they exist", () => {
    const mockConversations = [
      {
        id: "conv-1",
        title: "Team Discussion",
        agent_id: "agent-1",
        team_id: "team-1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T00:00:00Z",
      },
    ];

    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });
    useConversationStore.setState({ conversations: mockConversations });

    render(<TeamPanel />);
    expect(screen.getByText("Team Discussion")).toBeInTheDocument();
  });

  it("calls openTeamChat on team card click", () => {
    const openTeamChat = vi.fn();
    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({ team: mockTeams[0], members: [] }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });
    useConversationStore.setState({ openTeamChat });

    const { container } = render(<TeamPanel />);
    const card = container.querySelector(".team-card")!;
    fireEvent.click(card);

    expect(openTeamChat).toHaveBeenCalledWith("team-1", "agent-1");
  });

  it("displays member count from team detail", async () => {
    useTeamStore.setState({
      teams: [mockTeams[0]],
      loadTeams: vi.fn(),
      getTeamDetail: vi.fn().mockResolvedValue({
        team: mockTeams[0],
        members: [
          { id: "m1", team_id: "team-1", agent_id: "agent-1", role: "leader", joined_at: "" },
          { id: "m2", team_id: "team-1", agent_id: "agent-2", role: "member", joined_at: "" },
        ],
      }),
    });
    useAgentStore.setState({ agents: mockAgents, loadAgents: vi.fn() });

    render(<TeamPanel />);

    // memberCount => "{{count}}명" => "2명"
    await waitFor(() => {
      expect(screen.getByText("2명")).toBeInTheDocument();
    });
  });
});
