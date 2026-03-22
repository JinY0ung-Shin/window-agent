import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NoteEditor from "../NoteEditor";
import type { VaultNote } from "../../../services/vaultTypes";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown-preview">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

const baseNote: VaultNote = {
  id: "note-1",
  agent: "agent-1",
  noteType: "knowledge",
  scope: "agent",
  title: "Test Note",
  content: "Some content here",
  tags: ["tag1", "tag2"],
  confidence: 0.8,
  created: "2024-01-01T00:00:00Z",
  updated: "2024-01-01T00:00:00Z",
  revision: "rev-1",
  source: null,
  aliases: [],
  legacyId: null,
  lastEditedBy: null,
  path: "/vault/note-1.md",
};

describe("NoteEditor", () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn();
    onCancel = vi.fn();
  });

  it("renders with initial note values", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    const titleInput = screen.getByDisplayValue("Test Note");
    expect(titleInput).toBeInTheDocument();

    const textarea = screen.getByDisplayValue("Some content here");
    expect(textarea).toBeInTheDocument();

    const tagsInput = screen.getByDisplayValue("tag1, tag2");
    expect(tagsInput).toBeInTheDocument();
  });

  it("calls onSave with parsed tags when save button clicked", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    // common:save => "저장"
    const saveBtn = screen.getByText("저장");
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledWith({
      title: "Test Note",
      content: "Some content here",
      tags: ["tag1", "tag2"],
      confidence: 0.8,
    });
  });

  it("parses comma-separated tags correctly, trimming whitespace and filtering empty", () => {
    const note = { ...baseNote, tags: [] };
    render(<NoteEditor note={note} onSave={onSave} onCancel={onCancel} />);

    // editor.tagsSeparator => "쉼표로 구분"
    const tagsInput = screen.getByPlaceholderText("쉼표로 구분");
    fireEvent.change(tagsInput, { target: { value: " foo , bar ,, baz " } });

    const saveBtn = screen.getByText("저장");
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["foo", "bar", "baz"],
      }),
    );
  });

  it("calls onCancel directly when no changes made", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    // common:cancel => "취소"
    const cancelBtn = screen.getByText("취소");
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows confirm dialog on cancel when dirty", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);

    const titleInput = screen.getByDisplayValue("Test Note");
    fireEvent.change(titleInput, { target: { value: "Changed Title" } });

    const cancelBtn = screen.getByText("취소");
    fireEvent.click(cancelBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("allows cancel when confirm returns true on dirty state", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);

    const titleInput = screen.getByDisplayValue("Test Note");
    fireEvent.change(titleInput, { target: { value: "Changed Title" } });

    const cancelBtn = screen.getByText("취소");
    fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("toggles markdown preview", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);

    // Initially no preview
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();

    // toolbar.togglePreview => "미리보기 토글"
    const previewBtn = screen.getByTitle("미리보기 토글");
    fireEvent.click(previewBtn);

    expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("Some content here");
  });

  it("handles Ctrl+S keyboard shortcut", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(onSave).toHaveBeenCalled();
  });

  it("handles Cmd+S keyboard shortcut", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(onSave).toHaveBeenCalled();
  });

  it("does not trigger save on plain S key", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "s" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("updates confidence slider value", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.5" } });

    const saveBtn = screen.getByText("저장");
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.5 }),
    );
  });

  it("detects dirty state from title change", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);

    const titleInput = screen.getByDisplayValue("Test Note");
    fireEvent.change(titleInput, { target: { value: "New Title" } });

    const cancelBtn = screen.getByText("취소");
    fireEvent.click(cancelBtn);

    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("detects dirty state from content change", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);

    const textarea = screen.getByDisplayValue("Some content here");
    fireEvent.change(textarea, { target: { value: "Different content" } });

    const cancelBtn = screen.getByText("취소");
    fireEvent.click(cancelBtn);

    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("toolbar bold button exists", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByTitle("굵게 (Ctrl+B)")).toBeInTheDocument();
  });

  it("toolbar italic button exists", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByTitle("기울임 (Ctrl+I)")).toBeInTheDocument();
  });

  it("toolbar heading buttons exist", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByTitle("제목 1")).toBeInTheDocument();
    expect(screen.getByTitle("제목 2")).toBeInTheDocument();
    expect(screen.getByTitle("제목 3")).toBeInTheDocument();
  });

  it("toolbar wikilink button exists", () => {
    render(<NoteEditor note={baseNote} onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByTitle("위키링크")).toBeInTheDocument();
  });
});
