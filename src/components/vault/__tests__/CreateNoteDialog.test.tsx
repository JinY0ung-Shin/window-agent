import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateNoteDialog from "../CreateNoteDialog";
import { useVaultStore } from "../../../stores/vaultStore";

vi.mock("../../../services/commands/vaultCommands");

const initialVaultState = useVaultStore.getState();

beforeEach(() => {
  useVaultStore.setState(initialVaultState, true);
});

describe("CreateNoteDialog", () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  it("returns null when isOpen is false", () => {
    const { container } = render(
      <CreateNoteDialog isOpen={false} onClose={onClose} defaultAgentId="agent-1" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders form when isOpen is true", () => {
    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );
    // create.title => "새 노트 만들기"
    expect(screen.getByText("새 노트 만들기")).toBeInTheDocument();
    // create.submit => "만들기"
    expect(screen.getByText("만들기")).toBeInTheDocument();
  });

  it("renders all category radio buttons", () => {
    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );
    expect(screen.getByText("지식")).toBeInTheDocument();
    expect(screen.getByText("결정")).toBeInTheDocument();
    expect(screen.getByText("대화")).toBeInTheDocument();
    expect(screen.getByText("회고")).toBeInTheDocument();
  });

  it("renders scope radio buttons", () => {
    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );
    // create.agentOnly => "에이전트 전용", create.shared => "공유"
    expect(screen.getByText("에이전트 전용")).toBeInTheDocument();
    expect(screen.getByText("공유")).toBeInTheDocument();
  });

  it("shows error when title is empty on submit", async () => {
    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // create.titleRequired => "제목을 입력하세요"
      expect(screen.getByText("제목을 입력하세요")).toBeInTheDocument();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls createNote and onClose on successful submit", async () => {
    const createNoteMock = vi.fn().mockResolvedValue({
      id: "new-note-1",
      title: "My Note",
    });
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    // create.titlePlaceholder => "노트 제목"
    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "My Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "agent-1",
          scope: "agent",
          category: "knowledge",
          title: "My Note",
          content: "",
        }),
      );
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("uses 'user' as agentId when defaultAgentId is null", async () => {
    const createNoteMock = vi.fn().mockResolvedValue({ id: "new-note" });
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId={null} />,
    );

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "My Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "user" }),
      );
    });
  });

  it("shows error message when createNote fails", async () => {
    const createNoteMock = vi.fn().mockRejectedValue(new Error("Network error"));
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "My Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows fallback error when createNote fails with non-Error", async () => {
    const createNoteMock = vi.fn().mockRejectedValue("unknown failure");
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "My Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // create.failed => "노트 생성에 실패했습니다"
      expect(screen.getByText("노트 생성에 실패했습니다")).toBeInTheDocument();
    });
  });

  it("can switch category via radio buttons", async () => {
    const createNoteMock = vi.fn().mockResolvedValue({ id: "new-note" });
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    // category.decision => "결정"
    const decisionRadio = screen.getByText("결정");
    fireEvent.click(decisionRadio);

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "Decision Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: "decision" }),
      );
    });
  });

  it("can switch scope to shared", async () => {
    const createNoteMock = vi.fn().mockResolvedValue({ id: "new-note" });
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    // create.shared => "공유"
    const sharedRadio = screen.getByText("공유");
    fireEvent.click(sharedRadio);

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "Shared Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "shared" }),
      );
    });
  });

  it("parses tags correctly on submit", async () => {
    const createNoteMock = vi.fn().mockResolvedValue({ id: "new-note" });
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "Tagged Note" } });

    // create.tagsSeparator => "쉼표로 구분"
    const tagsInput = screen.getByPlaceholderText("쉼표로 구분");
    fireEvent.change(tagsInput, { target: { value: "react, typescript, , testing" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ["react", "typescript", "testing"],
        }),
      );
    });
  });

  it("sends undefined tags when no tags provided", async () => {
    const createNoteMock = vi.fn().mockResolvedValue({ id: "new-note" });
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "No Tags Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({ tags: undefined }),
      );
    });
  });

  it("calls onClose when overlay is clicked", () => {
    const { container } = render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const overlay = container.querySelector(".modal-overlay")!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when modal content is clicked", () => {
    const { container } = render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const content = container.querySelector(".modal-content")!;
    fireEvent.click(content);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables buttons while submitting", async () => {
    let resolveCreate: (value: unknown) => void;
    const createNoteMock = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    useVaultStore.setState({ createNote: createNoteMock });

    render(
      <CreateNoteDialog isOpen={true} onClose={onClose} defaultAgentId="agent-1" />,
    );

    const titleInput = screen.getByPlaceholderText("노트 제목");
    fireEvent.change(titleInput, { target: { value: "My Note" } });

    const submitBtn = screen.getByText("만들기");
    fireEvent.click(submitBtn);

    // create.creating => "생성 중…"
    await waitFor(() => {
      expect(screen.getByText("생성 중…")).toBeInTheDocument();
      expect(screen.getByText("생성 중…")).toBeDisabled();
    });

    resolveCreate!({ id: "done" });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
