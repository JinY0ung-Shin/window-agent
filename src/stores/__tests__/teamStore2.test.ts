import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTeamStore } from "../teamStore";
import type { Team, TeamDetail, TeamMember } from "../../services/types";

vi.mock("../../services/commands/teamCommands", () => ({
  listTeams: vi.fn().mockResolvedValue([]),
  createTeam: vi.fn().mockResolvedValue({ id: "team-new" }),
  updateTeam: vi.fn().mockResolvedValue({ id: "team-1" }),
  deleteTeam: vi.fn().mockResolvedValue(undefined),
  addTeamMember: vi.fn().mockResolvedValue({ id: "member-1" }),
  removeTeamMember: vi.fn().mockResolvedValue(undefined),
  getTeamDetail: vi.fn().mockResolvedValue({ team: {}, members: [] }),
}));

vi.mock("../../services/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

const mockTeam: Team = {
  id: "team-1",
  name: "Alpha Team",
  description: "Test team",
  leader_agent_id: "agent-1",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const mockMember: TeamMember = {
  id: "member-1",
  team_id: "team-1",
  agent_id: "agent-2",
  role: "member",
  joined_at: "2026-01-01",
};

const mockDetail: TeamDetail = {
  team: mockTeam,
  members: [mockMember],
};

const initial = useTeamStore.getState();

beforeEach(() => {
  useTeamStore.setState(initial, true);
  vi.clearAllMocks();
});

describe("teamStore", () => {
  // ── loadTeams ──

  it("loadTeams fetches and sets teams", async () => {
    const { listTeams } = await import("../../services/commands/teamCommands");
    vi.mocked(listTeams).mockResolvedValue([mockTeam]);

    await useTeamStore.getState().loadTeams();

    expect(listTeams).toHaveBeenCalled();
    expect(useTeamStore.getState().teams).toEqual([mockTeam]);
  });

  it("loadTeams sets empty array on error", async () => {
    const { listTeams } = await import("../../services/commands/teamCommands");
    vi.mocked(listTeams).mockRejectedValue(new Error("fail"));

    await useTeamStore.getState().loadTeams();

    expect(useTeamStore.getState().teams).toEqual([]);
  });

  // ── createTeam ──

  it("createTeam calls command and reloads teams", async () => {
    const { createTeam, listTeams } = await import("../../services/commands/teamCommands");
    const newTeam = { ...mockTeam, id: "team-new" };
    vi.mocked(createTeam).mockResolvedValue(newTeam);
    vi.mocked(listTeams).mockResolvedValue([newTeam]);

    const result = await useTeamStore.getState().createTeam("New Team", "desc", "agent-1", ["agent-2"]);

    expect(createTeam).toHaveBeenCalledWith({
      name: "New Team",
      description: "desc",
      leader_agent_id: "agent-1",
      member_agent_ids: ["agent-2"],
    });
    expect(result).toEqual(newTeam);
    expect(listTeams).toHaveBeenCalled();
  });

  // ── updateTeam ──

  it("updateTeam calls command and reloads teams", async () => {
    const { updateTeam, listTeams } = await import("../../services/commands/teamCommands");
    vi.mocked(updateTeam).mockResolvedValue(mockTeam);
    vi.mocked(listTeams).mockResolvedValue([mockTeam]);

    await useTeamStore.getState().updateTeam("team-1", { name: "Updated" });

    expect(updateTeam).toHaveBeenCalledWith("team-1", { name: "Updated" });
    expect(listTeams).toHaveBeenCalled();
  });

  it("updateTeam handles error gracefully", async () => {
    const { updateTeam } = await import("../../services/commands/teamCommands");
    vi.mocked(updateTeam).mockRejectedValue(new Error("fail"));

    await useTeamStore.getState().updateTeam("team-1", { name: "Updated" });

    // Should not throw
  });

  // ── deleteTeam ──

  it("deleteTeam removes team and reloads", async () => {
    const { deleteTeam, listTeams } = await import("../../services/commands/teamCommands");
    vi.mocked(deleteTeam).mockResolvedValue(undefined);
    vi.mocked(listTeams).mockResolvedValue([]);

    useTeamStore.setState({ teams: [mockTeam] });

    await useTeamStore.getState().deleteTeam("team-1");

    expect(deleteTeam).toHaveBeenCalledWith("team-1");
    expect(listTeams).toHaveBeenCalled();
  });

  it("deleteTeam clears selectedTeamId when deleting selected team", async () => {
    const { deleteTeam, listTeams } = await import("../../services/commands/teamCommands");
    vi.mocked(deleteTeam).mockResolvedValue(undefined);
    vi.mocked(listTeams).mockResolvedValue([]);

    useTeamStore.setState({ selectedTeamId: "team-1" });

    await useTeamStore.getState().deleteTeam("team-1");

    expect(useTeamStore.getState().selectedTeamId).toBeNull();
  });

  it("deleteTeam does not clear selectedTeamId when deleting different team", async () => {
    const { deleteTeam, listTeams } = await import("../../services/commands/teamCommands");
    vi.mocked(deleteTeam).mockResolvedValue(undefined);
    vi.mocked(listTeams).mockResolvedValue([]);

    useTeamStore.setState({ selectedTeamId: "team-2" });

    await useTeamStore.getState().deleteTeam("team-1");

    expect(useTeamStore.getState().selectedTeamId).toBe("team-2");
  });

  // ── addMember ──

  it("addMember calls command with default role", async () => {
    const { addTeamMember } = await import("../../services/commands/teamCommands");
    vi.mocked(addTeamMember).mockResolvedValue(mockMember);

    await useTeamStore.getState().addMember("team-1", "agent-2");

    expect(addTeamMember).toHaveBeenCalledWith("team-1", "agent-2", "member");
  });

  it("addMember calls command with custom role", async () => {
    const { addTeamMember } = await import("../../services/commands/teamCommands");
    vi.mocked(addTeamMember).mockResolvedValue(mockMember);

    await useTeamStore.getState().addMember("team-1", "agent-2", "specialist");

    expect(addTeamMember).toHaveBeenCalledWith("team-1", "agent-2", "specialist");
  });

  it("addMember handles error gracefully", async () => {
    const { addTeamMember } = await import("../../services/commands/teamCommands");
    vi.mocked(addTeamMember).mockRejectedValue(new Error("fail"));

    await useTeamStore.getState().addMember("team-1", "agent-2");

    // Should not throw
  });

  // ── removeMember ──

  it("removeMember calls command", async () => {
    const { removeTeamMember } = await import("../../services/commands/teamCommands");
    vi.mocked(removeTeamMember).mockResolvedValue(undefined);

    await useTeamStore.getState().removeMember("team-1", "agent-2");

    expect(removeTeamMember).toHaveBeenCalledWith("team-1", "agent-2");
  });

  it("removeMember handles error gracefully", async () => {
    const { removeTeamMember } = await import("../../services/commands/teamCommands");
    vi.mocked(removeTeamMember).mockRejectedValue(new Error("fail"));

    await useTeamStore.getState().removeMember("team-1", "agent-2");

    // Should not throw
  });

  // ── selectTeam ──

  it("selectTeam updates selectedTeamId", () => {
    useTeamStore.getState().selectTeam("team-1");
    expect(useTeamStore.getState().selectedTeamId).toBe("team-1");
  });

  it("selectTeam sets null", () => {
    useTeamStore.setState({ selectedTeamId: "team-1" });
    useTeamStore.getState().selectTeam(null);
    expect(useTeamStore.getState().selectedTeamId).toBeNull();
  });

  // ── openTeamEditor / closeTeamEditor ──

  it("openTeamEditor sets isTeamEditorOpen and editingTeamId", () => {
    useTeamStore.getState().openTeamEditor("team-1");

    const s = useTeamStore.getState();
    expect(s.isTeamEditorOpen).toBe(true);
    expect(s.editingTeamId).toBe("team-1");
  });

  it("openTeamEditor without teamId sets editingTeamId to null", () => {
    useTeamStore.getState().openTeamEditor();

    const s = useTeamStore.getState();
    expect(s.isTeamEditorOpen).toBe(true);
    expect(s.editingTeamId).toBeNull();
  });

  it("closeTeamEditor resets editor state", () => {
    useTeamStore.setState({ isTeamEditorOpen: true, editingTeamId: "team-1" });

    useTeamStore.getState().closeTeamEditor();

    const s = useTeamStore.getState();
    expect(s.isTeamEditorOpen).toBe(false);
    expect(s.editingTeamId).toBeNull();
  });

  // ── getTeamDetail ──

  it("getTeamDetail returns team detail", async () => {
    const { getTeamDetail } = await import("../../services/commands/teamCommands");
    vi.mocked(getTeamDetail).mockResolvedValue(mockDetail);

    const result = await useTeamStore.getState().getTeamDetail("team-1");

    expect(getTeamDetail).toHaveBeenCalledWith("team-1");
    expect(result).toEqual(mockDetail);
  });

  // ── initial state ──

  it("has correct initial state", () => {
    const s = useTeamStore.getState();
    expect(s.teams).toEqual([]);
    expect(s.selectedTeamId).toBeNull();
    expect(s.isTeamEditorOpen).toBe(false);
    expect(s.editingTeamId).toBeNull();
  });
});
