import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AgentEditor from "../AgentEditor";
import { useAgentStore } from "../../../stores/agentStore";
import { makeAgent, EMPTY_PERSONA } from "../../../__tests__/testFactories";

vi.mock("../../../services/tauriCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauriCommands")>();
  return {
    ...actual,
    listModels: vi.fn().mockResolvedValue(["model-a", "model-b"]),
  };
});
vi.mock("../AvatarUploader", () => ({
  default: () => <div data-testid="avatar-uploader" />,
}));

const initialState = useAgentStore.getState();

beforeEach(() => {
  useAgentStore.setState(initialState, true);
});

/** Common state for tests that need an open editor with a new agent */
function openNewEditor(extra: Record<string, unknown> = {}) {
  useAgentStore.setState({
    isEditorOpen: true,
    editingAgentId: null,
    personaFiles: EMPTY_PERSONA,
    ...extra,
  });
}

describe("AgentEditor", () => {
  it("returns null when isEditorOpen=false", () => {
    useAgentStore.setState({ isEditorOpen: false });
    const { container } = render(<AgentEditor />);
    expect(container.innerHTML).toBe("");
  });

  it("renders modal when isEditorOpen=true", () => {
    openNewEditor();
    render(<AgentEditor />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("새 에이전트");
  });

  it("shows '새 에이전트' title for new agent (editingAgentId=null)", () => {
    openNewEditor();
    render(<AgentEditor />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("새 에이전트");
  });

  it("shows '에이전트 편집' title when editing (editingAgentId set)", () => {
    useAgentStore.setState({
      isEditorOpen: true,
      editingAgentId: "test-id",
      agents: [makeAgent()],
      personaFiles: EMPTY_PERSONA,
    });
    render(<AgentEditor />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("에이전트 편집");
  });

  it("renders 4 persona tabs", () => {
    openNewEditor();
    render(<AgentEditor />);
    expect(screen.getByText("IDENTITY")).toBeInTheDocument();
    expect(screen.getByText("SOUL")).toBeInTheDocument();
    expect(screen.getByText("USER")).toBeInTheDocument();
    expect(screen.getByText("AGENTS")).toBeInTheDocument();
  });

  it("clicking tab calls setPersonaTab", () => {
    const setTabSpy = vi.fn();
    openNewEditor({ setPersonaTab: setTabSpy });
    render(<AgentEditor />);

    fireEvent.click(screen.getByText("SOUL"));
    expect(setTabSpy).toHaveBeenCalledWith("soul");
  });

  it("save button calls saveAgent", () => {
    const saveSpy = vi.fn();
    openNewEditor({ saveAgent: saveSpy });
    render(<AgentEditor />);

    fireEvent.click(screen.getByText("저장"));
    expect(saveSpy).toHaveBeenCalled();
  });

  it("cancel button calls closeEditor", () => {
    const closeSpy = vi.fn();
    openNewEditor({ closeEditor: closeSpy });
    render(<AgentEditor />);

    fireEvent.click(screen.getByText("취소"));
    expect(closeSpy).toHaveBeenCalled();
  });

  it("delete button hidden for default agent (is_default=true)", () => {
    useAgentStore.setState({
      isEditorOpen: true,
      editingAgentId: "test-id",
      agents: [makeAgent({ is_default: true })],
      personaFiles: EMPTY_PERSONA,
    });
    render(<AgentEditor />);
    expect(screen.queryByText("에이전트 삭제")).not.toBeInTheDocument();
  });

  it("delete button visible and works for non-default agent", () => {
    const deleteSpy = vi.fn();
    useAgentStore.setState({
      isEditorOpen: true,
      editingAgentId: "test-id",
      agents: [makeAgent({ is_default: false })],
      personaFiles: EMPTY_PERSONA,
      deleteAgent: deleteSpy,
    });
    render(<AgentEditor />);

    const deleteBtn = screen.getByText("에이전트 삭제");
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);
    expect(deleteSpy).toHaveBeenCalledWith("test-id");
  });
});
