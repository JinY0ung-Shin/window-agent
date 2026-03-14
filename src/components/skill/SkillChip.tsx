import { Loader2 } from "lucide-react";
import type { SkillMetadata } from "../../services/types";

interface Props {
  skill: SkillMetadata;
  isActive: boolean;
  isLoading?: boolean;
  onToggle: (skillName: string) => void;
}

export default function SkillChip({ skill, isActive, isLoading, onToggle }: Props) {
  const hasDiagnostics = skill.diagnostics.length > 0;

  const tooltipText = [
    skill.description,
    ...(hasDiagnostics ? [`\n${skill.diagnostics.join("\n")}`] : []),
  ].join("");

  return (
    <button
      className={`skill-chip ${isActive ? "active" : ""} ${isLoading ? "loading" : ""}`}
      onClick={() => !isLoading && onToggle(skill.name)}
      title={tooltipText}
      disabled={isLoading}
    >
      {isLoading ? <Loader2 size={12} className="skill-chip-spinner" /> : null}
      <span className="skill-chip-name">{skill.name}</span>
      {hasDiagnostics && <span className="skill-chip-warn">!</span>}
    </button>
  );
}
