import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SkillChip from "../SkillChip";
import type { SkillMetadata } from "../../../services/types";

const baseSkill: SkillMetadata = {
  name: "code-review",
  description: "코드 리뷰 기준을 제공합니다",
  source: "agent",
  path: "/agents/test/skills/code-review",
  diagnostics: [],
};

describe("SkillChip", () => {
  it("renders skill name", () => {
    render(<SkillChip skill={baseSkill} isActive={false} onToggle={vi.fn()} />);
    expect(screen.getByText("code-review")).toBeInTheDocument();
  });

  it("applies active class when isActive", () => {
    render(<SkillChip skill={baseSkill} isActive={true} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button.classList.contains("active")).toBe(true);
  });

  it("does not apply active class when inactive", () => {
    render(<SkillChip skill={baseSkill} isActive={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button.classList.contains("active")).toBe(false);
  });

  it("calls onToggle with skill name on click", () => {
    const onToggle = vi.fn();
    render(<SkillChip skill={baseSkill} isActive={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith("code-review");
  });

  it("does not call onToggle when loading", () => {
    const onToggle = vi.fn();
    render(<SkillChip skill={baseSkill} isActive={false} isLoading={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows warning indicator when diagnostics present", () => {
    const skillWithDiag: SkillMetadata = {
      ...baseSkill,
      diagnostics: ["Missing description"],
    };
    render(<SkillChip skill={skillWithDiag} isActive={false} onToggle={vi.fn()} />);
    expect(screen.getByText("!")).toBeInTheDocument();
  });

  it("does not show warning indicator when no diagnostics", () => {
    render(<SkillChip skill={baseSkill} isActive={false} onToggle={vi.fn()} />);
    expect(screen.queryByText("!")).not.toBeInTheDocument();
  });
});
