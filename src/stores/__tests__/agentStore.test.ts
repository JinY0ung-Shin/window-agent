import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../agentStore";
import * as cmds from "../../services/tauriCommands";
import * as personaService from "../../services/personaService";
import { makeAgent, EMPTY_PERSONA } from "../../__tests__/testFactories";
import type { PersonaFiles } from "../../services/types";

vi.mock("../../services/tauriCommands");
vi.mock("../../services/personaService", () => ({
  readPersonaFiles: vi.fn().mockResolvedValue({
    identity: "",
    soul: "",
    user: "",
    agents: "",
  }),
  writePersonaFiles: vi.fn().mockResolvedValue(undefined),
  invalidatePersonaCache: vi.fn(),
}));

const initialState = useAgentStore.getState();

beforeEach(() => {
  useAgentStore.setState(initialState, true);
  vi.clearAllMocks();
});


describe("agentStore", () => {
  it("has correct initial state", () => {
    const s = useAgentStore.getState();
    expect(s.agents).toEqual([]);
    expect(s.selectedAgentId).toBeNull();
    expect(s.isEditorOpen).toBe(false);
  });

  it("loadAgents fetches and sets agents", async () => {
    const mockAgents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    vi.mocked(cmds.listAgents).mockResolvedValue(mockAgents);

    await useAgentStore.getState().loadAgents();

    expect(cmds.listAgents).toHaveBeenCalled();
    expect(useAgentStore.getState().agents).toEqual(mockAgents);
  });

  it("loadAgents sets empty array on error", async () => {
    vi.mocked(cmds.listAgents).mockRejectedValue(new Error("fail"));

    await useAgentStore.getState().loadAgents();

    expect(useAgentStore.getState().agents).toEqual([]);
  });

  it("selectAgent updates selectedAgentId", () => {
    useAgentStore.getState().selectAgent("agent-1");
    expect(useAgentStore.getState().selectedAgentId).toBe("agent-1");
  });

  it("openEditor sets isEditorOpen=true and resets personaTab to identity", async () => {
    useAgentStore.setState({ personaTab: "soul" });

    await useAgentStore.getState().openEditor(null);

    const s = useAgentStore.getState();
    expect(s.isEditorOpen).toBe(true);
    expect(s.personaTab).toBe("identity");
  });

  it("openEditor with agentId reads persona files", async () => {
    const agent = makeAgent({ id: "a1", folder_name: "a1-folder" });
    useAgentStore.setState({ agents: [agent] });

    const mockFiles: PersonaFiles = {
      identity: "id content",
      soul: "soul content",
      user: "user content",
      agents: "agents content",
    };
    vi.mocked(personaService.readPersonaFiles).mockResolvedValue(mockFiles);

    await useAgentStore.getState().openEditor("a1");

    expect(personaService.readPersonaFiles).toHaveBeenCalledWith("a1-folder");
    expect(useAgentStore.getState().personaFiles).toEqual(mockFiles);
  });

  it("openEditor sets empty persona when agent not found", async () => {
    useAgentStore.setState({ agents: [] });

    await useAgentStore.getState().openEditor("nonexistent");

    expect(useAgentStore.getState().personaFiles).toEqual(EMPTY_PERSONA);
  });

  it("closeEditor resets all editor state", async () => {
    useAgentStore.setState({
      isEditorOpen: true,
      editingAgentId: "a1",
      personaFiles: { identity: "x", soul: "y", user: "z", agents: "w", tools: "" },
      personaTab: "soul",
    });

    useAgentStore.getState().closeEditor();

    const s = useAgentStore.getState();
    expect(s.isEditorOpen).toBe(false);
    expect(s.editingAgentId).toBeNull();
    expect(s.personaFiles).toBeNull();
    expect(s.personaTab).toBe("identity");
  });

  it("setPersonaTab updates tab", () => {
    useAgentStore.getState().setPersonaTab("agents");
    expect(useAgentStore.getState().personaTab).toBe("agents");
  });

  it("updatePersonaFile modifies specific file, preserves others", () => {
    useAgentStore.setState({
      personaFiles: { identity: "old", soul: "keep", user: "keep", agents: "keep", tools: "" },
    });

    useAgentStore.getState().updatePersonaFile("identity", "new");

    const files = useAgentStore.getState().personaFiles!;
    expect(files.identity).toBe("new");
    expect(files.soul).toBe("keep");
  });

  it("updatePersonaFile does nothing when personaFiles is null", () => {
    useAgentStore.setState({ personaFiles: null });

    useAgentStore.getState().updatePersonaFile("identity", "content");

    expect(useAgentStore.getState().personaFiles).toBeNull();
  });

  it("saveAgent creates new agent when editingAgentId is null", async () => {
    const createdAgent = makeAgent({ id: "new-1", folder_name: "helper" });
    vi.mocked(cmds.createAgent).mockResolvedValue(createdAgent);
    vi.mocked(cmds.listAgents).mockResolvedValue([createdAgent]);

    useAgentStore.setState({
      editingAgentId: null,
      personaFiles: { identity: "id", soul: "so", user: "us", agents: "ag" },
    });

    await useAgentStore.getState().saveAgent({ name: "Helper" });

    expect(cmds.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Helper", folder_name: "helper" }),
    );
    expect(personaService.writePersonaFiles).toHaveBeenCalledWith("helper", {
      identity: "id",
      soul: "so",
      user: "us",
      agents: "ag",
    });
  });

  it("saveAgent updates existing when editingAgentId is set", async () => {
    const agent = makeAgent({ id: "existing-1", folder_name: "existing-folder" });
    vi.mocked(cmds.updateAgent).mockResolvedValue(agent);
    vi.mocked(cmds.listAgents).mockResolvedValue([agent]);

    useAgentStore.setState({
      agents: [agent],
      editingAgentId: "existing-1",
      personaFiles: { identity: "updated", soul: "", user: "", agents: "" },
    });

    await useAgentStore.getState().saveAgent({ name: "Updated" });

    expect(cmds.updateAgent).toHaveBeenCalledWith(
      "existing-1",
      expect.objectContaining({ name: "Updated" }),
    );
    expect(personaService.writePersonaFiles).toHaveBeenCalledWith("existing-folder", {
      identity: "updated",
      soul: "",
      user: "",
      agents: "",
    });
  });

  it("deleteAgent clears selectedAgentId if matching deleted ID", async () => {
    vi.mocked(cmds.deleteAgent).mockResolvedValue(undefined);
    vi.mocked(cmds.listAgents).mockResolvedValue([]);

    useAgentStore.setState({ selectedAgentId: "del-1" });

    await useAgentStore.getState().deleteAgent("del-1");

    expect(cmds.deleteAgent).toHaveBeenCalledWith("del-1");
    expect(useAgentStore.getState().selectedAgentId).toBeNull();
  });
});
