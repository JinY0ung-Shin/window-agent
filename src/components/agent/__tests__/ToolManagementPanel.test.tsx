import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToolManagementPanel from "../ToolManagementPanel";

const STRUCTURED_CONTENT = `## web_search
- description: Search the web
- tier: auto
- parameters:
  - query (string, required): Search query

## file_read
- description: Read a file
- tier: confirm
`;

const RAW_CONTENT = `# My custom tools

Some freeform text that can't round-trip.

## weird-tool-name
- description: A tool
- tier: auto
`;

describe("ToolManagementPanel", () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
  });

  it("renders structured mode for round-trippable content", () => {
    render(<ToolManagementPanel rawContent={STRUCTURED_CONTENT} onChange={onChange} />);
    expect(screen.getByText("도구 2개")).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.getByText("file_read")).toBeInTheDocument();
  });

  it("renders raw mode for non-round-trippable content", () => {
    render(<ToolManagementPanel rawContent={RAW_CONTENT} onChange={onChange} />);
    expect(screen.getByText(/수동 편집된 내용/)).toBeInTheDocument();
  });

  it("switches from raw to structured mode", () => {
    render(<ToolManagementPanel rawContent={RAW_CONTENT} onChange={onChange} />);
    fireEvent.click(screen.getByText("구조화된 편집기로 전환 (내용이 변환됩니다)"));
    // After switching, we should see the tool list (even if it parsed partially)
    expect(screen.queryByText(/수동 편집된 내용/)).not.toBeInTheDocument();
  });

  it("opens add form when clicking add button", () => {
    render(<ToolManagementPanel rawContent={STRUCTURED_CONTENT} onChange={onChange} />);
    fireEvent.click(screen.getByText("새 도구 추가"));
    expect(screen.getByText("새 도구 추가", { selector: ".tool-form-title" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("예: web_search")).toBeInTheDocument();
  });

  it("adds a new tool via structured editor", () => {
    render(<ToolManagementPanel rawContent={STRUCTURED_CONTENT} onChange={onChange} />);
    fireEvent.click(screen.getByText("새 도구 추가"));

    fireEvent.change(screen.getByPlaceholderText("예: web_search"), {
      target: { value: "my_tool" },
    });
    fireEvent.change(screen.getByPlaceholderText("이 도구가 하는 일을 설명합니다"), {
      target: { value: "Does stuff" },
    });

    fireEvent.click(screen.getByText("저장"));
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain("my_tool");
    expect(lastCall).toContain("Does stuff");
  });

  it("deletes a tool from structured editor", () => {
    render(<ToolManagementPanel rawContent={STRUCTURED_CONTENT} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle("삭제");
    fireEvent.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).not.toContain("web_search");
    expect(lastCall).toContain("file_read");
  });

  it("opens edit form for existing tool", () => {
    render(<ToolManagementPanel rawContent={STRUCTURED_CONTENT} onChange={onChange} />);
    const editButtons = screen.getAllByTitle("편집");
    fireEvent.click(editButtons[0]);
    expect(screen.getByText("도구 편집")).toBeInTheDocument();
    expect(screen.getByDisplayValue("web_search")).toBeInTheDocument();
  });

  it("edits raw text in raw mode", () => {
    render(<ToolManagementPanel rawContent={RAW_CONTENT} onChange={onChange} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new content" } });
    expect(onChange).toHaveBeenCalledWith("new content");
  });

  it("renders empty state when no tools", () => {
    render(<ToolManagementPanel rawContent="" onChange={onChange} />);
    expect(screen.getByText("등록된 도구 없음")).toBeInTheDocument();
    expect(screen.getByText(/도구를 추가하면/)).toBeInTheDocument();
  });

  it("shows validation error for empty tool name", () => {
    render(<ToolManagementPanel rawContent={STRUCTURED_CONTENT} onChange={onChange} />);
    fireEvent.click(screen.getByText("새 도구 추가"));
    // Name is empty, save button should be disabled
    const saveBtn = screen.getByText("저장").closest("button")!;
    expect(saveBtn).toBeDisabled();
  });
});
