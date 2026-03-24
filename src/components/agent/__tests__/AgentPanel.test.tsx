import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AgentPanel from "../AgentPanel";
import { useAgentStore } from "../../../stores/agentStore";
import { useNavigationStore } from "../../../stores/navigationStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useBootstrapStore } from "../../../stores/bootstrapStore";
import { makeAgent } from "../../../__tests__/testFactories";

vi.mock("../../../services/tauriCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauriCommands")>();
  return {
    ...actual,
    listAgents: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockResolvedValue(["model-a"]),
  };
});
vi.mock("../../../services/personaService", () => ({
  readPersonaFiles: vi.fn().mockResolvedValue({
    identity: "",
    soul: "",
    user: "",
    agents: "",
  }),
  writePersonaFiles: vi.fn().mockResolvedValue(undefined),
  invalidatePersonaCache: vi.fn(),
}));
vi.mock("../../../stores/resetHelper", () => ({
  resetChatContext: vi.fn(),
}));
vi.mock("../AvatarUploader", () => ({
  default: () => <div data-testid="avatar-uploader" />,
}));
vi.mock("../../../hooks/useDragRegion", () => ({
  useDragRegion: () => vi.fn(),
}));

const agentInitial = useAgentStore.getState();
const navInitial = useNavigationStore.getState();
const settingsInitial = useSettingsStore.getState();
const bootstrapInitial = useBootstrapStore.getState();

beforeEach(() => {
  useAgentStore.setState(agentInitial, true);
  useNavigationStore.setState(navInitial, true);
  useSettingsStore.setState(settingsInitial, true);
  useBootstrapStore.setState(bootstrapInitial, true);
  vi.clearAllMocks();
});

describe("AgentPanel", () => {
  it("renders empty state when no agents", async () => {
    useAgentStore.setState({ agents: [], loadAgents: vi.fn() });
    await act(async () => { render(<AgentPanel />); });
    // EmptyState renders with class "agent-empty"
    const emptyState = document.querySelector(".agent-empty");
    expect(emptyState).toBeTruthy();
  });

  it("renders agent cards when agents exist", async () => {
    const agents = [
      makeAgent({ id: "a1", name: "Alice" }),
      makeAgent({ id: "a2", name: "Bob" }),
    ];
    useAgentStore.setState({ agents, loadAgents: vi.fn() });
    await act(async () => { render(<AgentPanel />); });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows default badge for default agent", async () => {
    const agents = [makeAgent({ id: "a1", name: "Lead", is_default: true })];
    useAgentStore.setState({ agents, loadAgents: vi.fn() });
    await act(async () => { render(<AgentPanel />); });
    // badge text varies by theme, look for the badge element
    const badge = document.querySelector(".agent-card-badge");
    expect(badge).toBeTruthy();
  });

  it("clicking agent card calls openEditor", async () => {
    const openEditorSpy = vi.fn();
    const agents = [makeAgent({ id: "a1", name: "Alice" })];
    useAgentStore.setState({ agents, loadAgents: vi.fn(), openEditor: openEditorSpy });
    await act(async () => { render(<AgentPanel />); });

    fireEvent.click(screen.getByText("Alice"));
    expect(openEditorSpy).toHaveBeenCalledWith("a1");
  });

  it("does not render AgentEditor when isEditorOpen is false", async () => {
    useAgentStore.setState({ agents: [], loadAgents: vi.fn(), isEditorOpen: false });
    await act(async () => { render(<AgentPanel />); });
    // AgentEditor renders a Modal with class "modal-overlay"; should not be present
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("hides delete button for default agent", async () => {
    const agents = [makeAgent({ id: "a1", name: "Default", is_default: true })];
    useAgentStore.setState({ agents, loadAgents: vi.fn() });
    await act(async () => { render(<AgentPanel />); });
    const deleteBtn = document.querySelector(".agent-card-delete");
    expect(deleteBtn).toBeNull();
  });
});
