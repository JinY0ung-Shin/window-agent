import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHubStore } from "../hubStore";
import { useAgentStore } from "../agentStore";
import { makeAgent } from "../../__tests__/testFactories";
import * as hubCommands from "../../services/commands/hubCommands";
import * as agentCommands from "../../services/commands/agentCommands";
import * as skillCommands from "../../services/commands/skillCommands";
import * as personaService from "../../services/personaService";
import * as tauriCommands from "../../services/tauriCommands";

vi.mock("../../services/commands/hubCommands", () => ({
  hubGetAuthStatus: vi.fn(),
  hubLogin: vi.fn(),
  hubRegister: vi.fn(),
  hubLogout: vi.fn(),
  hubListAgents: vi.fn(),
  hubListSkills: vi.fn(),
  hubListNotes: vi.fn(),
  hubDeleteAgent: vi.fn(),
  hubDeleteSkill: vi.fn(),
  hubDeleteNote: vi.fn(),
  hubShareAgent: vi.fn(),
  hubShareSkills: vi.fn(),
  hubShareNotes: vi.fn(),
}));

vi.mock("../../services/commands/skillCommands", () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  readSkill: vi.fn(),
  createSkill: vi.fn().mockResolvedValue(undefined),
  updateSkill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/commands/memoryCommands", () => ({
  listMemoryNotes: vi.fn().mockResolvedValue([]),
  createMemoryNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/commands/agentCommands", () => ({
  createAgent: vi.fn(),
}));

vi.mock("../../services/personaService", async () => {
  const actual = await vi.importActual<typeof import("../../services/personaService")>("../../services/personaService");
  return {
    ...actual,
    readPersonaFiles: vi.fn().mockResolvedValue({
      identity: "",
      soul: "",
      user: "",
      agents: "",
    }),
    writePersonaFiles: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../services/tauriCommands", () => ({
  listAgents: vi.fn().mockResolvedValue([]),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  createAgent: vi.fn(),
  readAgentFile: vi.fn(),
  writeAgentFile: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const hubInitial = useHubStore.getState();
const agentInitial = useAgentStore.getState();

describe("hubStore", () => {
  beforeEach(() => {
    useHubStore.setState(hubInitial, true);
    useAgentStore.setState(agentInitial, true);
    vi.clearAllMocks();

    vi.mocked(hubCommands.hubListAgents).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    vi.mocked(hubCommands.hubListSkills).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    vi.mocked(hubCommands.hubListNotes).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    vi.mocked(tauriCommands.listAgents).mockResolvedValue([]);
  });

  it("refreshes my shares after a successful share on the mine tab", async () => {
    vi.mocked(hubCommands.hubShareAgent).mockResolvedValue({
      id: "shared-1",
      user_id: "user-1",
      display_name: "me",
      name: "Shared Agent",
      description: "shared desc",
      original_agent_id: "local-1",
      persona: null,
      skills_count: 0,
      notes_count: 0,
      created_at: "",
      updated_at: "",
    });
    vi.mocked(hubCommands.hubListAgents).mockResolvedValue({
      items: [{
        id: "shared-1",
        user_id: "user-1",
        display_name: "me",
        name: "Shared Agent",
        description: "shared desc",
        original_agent_id: "local-1",
        persona: null,
        skills_count: 0,
        notes_count: 0,
        created_at: "",
        updated_at: "",
      }],
      total: 1,
      limit: 50,
      offset: 0,
    });

    useHubStore.setState({
      activeTab: "mine",
      userId: "user-1",
      shareMode: "agent",
      shareAgentId: "local-1",
      shareFolderName: "local-folder",
      shareAgentName: "Shared Agent",
      shareAgentDesc: "shared desc",
      selectedSkillNames: new Set(),
      selectedNoteIds: new Set(),
      localSkills: [],
      localNotes: [],
    });

    await useHubStore.getState().executeShare();

    expect(hubCommands.hubShareAgent).toHaveBeenCalledWith("Shared Agent", "shared desc", "local-1", undefined);
    expect(hubCommands.hubListAgents).toHaveBeenCalledWith(undefined, 50, 0, "user-1");
    expect(useHubStore.getState().myAgents).toHaveLength(1);
    expect(useHubStore.getState().shareResult).toEqual(expect.objectContaining({ success: true, agentId: "shared-1" }));
  });

  it("refreshes the browse agent list after sharing an agent from the agents tab", async () => {
    vi.mocked(hubCommands.hubShareAgent).mockResolvedValue({
      id: "shared-1",
      user_id: "user-1",
      display_name: "me",
      name: "Shared Agent",
      description: "shared desc",
      original_agent_id: "local-1",
      persona: null,
      skills_count: 0,
      notes_count: 0,
      created_at: "",
      updated_at: "",
    });

    useHubStore.setState({
      activeTab: "agents",
      shareMode: "agent",
      shareAgentId: "local-1",
      shareFolderName: "local-folder",
      shareAgentName: "Shared Agent",
      shareAgentDesc: "shared desc",
      selectedSkillNames: new Set(),
      selectedNoteIds: new Set(),
      localSkills: [],
      localNotes: [],
    });

    await useHubStore.getState().executeShare();

    expect(hubCommands.hubListAgents).toHaveBeenCalledWith(undefined, 20, 0);
  });

  it("refreshes the browse skill list after sharing a skill from the skills tab", async () => {
    vi.mocked(hubCommands.hubShareSkills).mockResolvedValue([{
      id: "skill-1",
      user_id: "user-1",
      display_name: "me",
      agent_id: null,
      agent_name: null,
      skill_name: "skill-a",
      description: "skill desc",
      body: "skill body",
      created_at: "",
    }]);
    vi.mocked(skillCommands.readSkill).mockResolvedValue({ raw_content: "skill body" } as Awaited<ReturnType<typeof skillCommands.readSkill>>);

    useHubStore.setState({
      activeTab: "skills",
      shareMode: "skill",
      shareAgentId: null,
      shareFolderName: "local-folder",
      shareAgentName: "",
      shareAgentDesc: "",
      selectedSkillNames: new Set(["skill-a"]),
      selectedNoteIds: new Set(),
      localSkills: [{ name: "skill-a", description: "skill desc", source: "agent", path: "skills/skill-a", diagnostics: [] }],
      localNotes: [],
    });

    await useHubStore.getState().executeShare();

    expect(hubCommands.hubShareSkills).toHaveBeenCalledWith(null, [{
      name: "skill-a",
      description: "skill desc",
      body: "skill body",
    }]);
    expect(hubCommands.hubListSkills).toHaveBeenCalledWith(undefined, undefined, 20, 0);
  });

  it("refreshes the local agent store after hiring a shared agent", async () => {
    const importedAgent = makeAgent({ id: "new-1", folder_name: "shared-agent", name: "Shared Agent" });
    vi.mocked(agentCommands.createAgent).mockResolvedValue(importedAgent);
    vi.mocked(tauriCommands.listAgents).mockResolvedValue([importedAgent]);

    useHubStore.setState({
      selectedAgentId: "shared-1",
      agents: [{
        id: "shared-1",
        user_id: "user-1",
        display_name: "owner",
        name: "Shared Agent",
        description: "Imported description",
        original_agent_id: null,
        persona: null,
        skills_count: 0,
        notes_count: 0,
        created_at: "",
        updated_at: "",
      }],
      myAgents: [],
      agentSkills: [],
      agentNotes: [],
    });

    await useHubStore.getState().hireAgent("Shared Agent", "Imported description");

    expect(agentCommands.createAgent).toHaveBeenCalledWith({
      folder_name: "shared-agent",
      name: "Shared Agent",
      description: "Imported description",
    });
    expect(tauriCommands.listAgents).toHaveBeenCalledTimes(1);
    expect(useAgentStore.getState().agents).toEqual([importedAgent]);
  });

  it("writes fallback identity for hired agents when shared persona is missing", async () => {
    const importedAgent = makeAgent({ id: "new-1", folder_name: "shared-agent", name: "Shared Agent" });
    vi.mocked(agentCommands.createAgent).mockResolvedValue(importedAgent);

    useHubStore.setState({
      selectedAgentId: "shared-1",
      agents: [{
        id: "shared-1",
        user_id: "user-1",
        display_name: "owner",
        name: "Shared Agent",
        description: "Imported description",
        original_agent_id: null,
        persona: null,
        skills_count: 0,
        notes_count: 0,
        created_at: "",
        updated_at: "",
      }],
      myAgents: [],
      agentSkills: [],
      agentNotes: [],
    });

    await useHubStore.getState().hireAgent("Shared Agent", "Imported description");

    expect(personaService.writePersonaFiles).toHaveBeenCalledWith("shared-agent", {
      identity: "# Shared Agent\n\nImported description",
      soul: "",
      user: "",
      agents: "",
    });
  });

  it("falls back to generated identity when shared persona identity is only whitespace", async () => {
    const importedAgent = makeAgent({ id: "new-1", folder_name: "shared-agent", name: "Shared Agent" });
    vi.mocked(agentCommands.createAgent).mockResolvedValue(importedAgent);

    useHubStore.setState({
      selectedAgentId: "shared-1",
      agents: [{
        id: "shared-1",
        user_id: "user-1",
        display_name: "owner",
        name: "Shared Agent",
        description: "Imported description",
        original_agent_id: null,
        persona: {
          identity: "   ",
          soul: "Original soul",
          user_context: "Original user",
          agents: "Original agents",
        },
        skills_count: 0,
        notes_count: 0,
        created_at: "",
        updated_at: "",
      }],
      myAgents: [],
      agentSkills: [],
      agentNotes: [],
    });

    await useHubStore.getState().hireAgent("Shared Agent", "Imported description");

    expect(personaService.writePersonaFiles).toHaveBeenCalledWith("shared-agent", {
      identity: "# Shared Agent\n\nImported description",
      soul: "Original soul",
      user: "Original user",
      agents: "Original agents",
    });
  });

  it("preserves shared persona when hiring an agent that already has one", async () => {
    const importedAgent = makeAgent({ id: "new-1", folder_name: "shared-agent", name: "Shared Agent" });
    vi.mocked(agentCommands.createAgent).mockResolvedValue(importedAgent);

    useHubStore.setState({
      selectedAgentId: "shared-1",
      agents: [{
        id: "shared-1",
        user_id: "user-1",
        display_name: "owner",
        name: "Shared Agent",
        description: "Imported description",
        original_agent_id: null,
        persona: {
          identity: "# Original Name\n\nOriginal identity",
          soul: "Original soul",
          user_context: "Original user",
          agents: "Original agents",
        },
        skills_count: 0,
        notes_count: 0,
        created_at: "",
        updated_at: "",
      }],
      myAgents: [],
      agentSkills: [],
      agentNotes: [],
    });

    await useHubStore.getState().hireAgent("Shared Agent", "Imported description");

    expect(personaService.writePersonaFiles).toHaveBeenCalledWith("shared-agent", {
      identity: "# Original Name\n\nOriginal identity",
      soul: "Original soul",
      user: "Original user",
      agents: "Original agents",
    });
  });
});
