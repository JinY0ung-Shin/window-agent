import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

  it("renders modal when isEditorOpen=true", async () => {
    openNewEditor();
    await act(async () => { render(<AgentEditor />); });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("신규 채용");
  });

  it("shows '신규 채용' title for new agent (editingAgentId=null)", async () => {
    openNewEditor();
    await act(async () => { render(<AgentEditor />); });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("신규 채용");
  });

  it("shows '인사 관리' title when editing (editingAgentId set)", async () => {
    useAgentStore.setState({
      isEditorOpen: true,
      editingAgentId: "test-id",
      agents: [makeAgent()],
      personaFiles: EMPTY_PERSONA,
    });
    await act(async () => { render(<AgentEditor />); });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("인사 관리");
  });

  it("renders 4 persona tabs", async () => {
    openNewEditor();
    await act(async () => { render(<AgentEditor />); });
    expect(screen.getByText("신상정보")).toBeInTheDocument();
    expect(screen.getByText("성격/가치관")).toBeInTheDocument();
    expect(screen.getByText("상사 정보")).toBeInTheDocument();
    expect(screen.getByText("업무 규칙")).toBeInTheDocument();
  });

  it("clicking tab calls setPersonaTab", async () => {
    const setTabSpy = vi.fn();
    openNewEditor({ setPersonaTab: setTabSpy });
    await act(async () => { render(<AgentEditor />); });

    fireEvent.click(screen.getByText("성격/가치관"));
    expect(setTabSpy).toHaveBeenCalledWith("soul");
  });

  it("save button calls saveAgent", async () => {
    const saveSpy = vi.fn();
    openNewEditor({ saveAgent: saveSpy });
    await act(async () => { render(<AgentEditor />); });

    fireEvent.click(screen.getByText("저장"));
    expect(saveSpy).toHaveBeenCalled();
  });

  it("cancel button calls closeEditor", async () => {
    const closeSpy = vi.fn();
    openNewEditor({ closeEditor: closeSpy });
    await act(async () => { render(<AgentEditor />); });

    fireEvent.click(screen.getByText("취소"));
    expect(closeSpy).toHaveBeenCalled();
  });

  it("delete button hidden for default agent (is_default=true)", async () => {
    useAgentStore.setState({
      isEditorOpen: true,
      editingAgentId: "test-id",
      agents: [makeAgent({ is_default: true })],
      personaFiles: EMPTY_PERSONA,
    });
    await act(async () => { render(<AgentEditor />); });
    expect(screen.queryByText("해고하기")).not.toBeInTheDocument();
  });

  it("delete button visible and works for non-default agent", async () => {
    const deleteSpy = vi.fn();
    useAgentStore.setState({
      isEditorOpen: true,
      editingAgentId: "test-id",
      agents: [makeAgent({ is_default: false })],
      personaFiles: EMPTY_PERSONA,
      deleteAgent: deleteSpy,
    });
    await act(async () => { render(<AgentEditor />); });

    const deleteBtn = screen.getByText("해고하기");
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);
    expect(deleteSpy).toHaveBeenCalledWith("test-id");
  });
});
