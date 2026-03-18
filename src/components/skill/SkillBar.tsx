import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useSkillStore } from "../../stores/skillStore";
import { useAgentStore } from "../../stores/agentStore";
import { useConversationStore } from "../../stores/conversationStore";
import SkillChip from "./SkillChip";

interface Props {
  agentId: string;
}

export default function SkillBar({ agentId }: Props) {
  const { t } = useTranslation("agent");
  const availableSkills = useSkillStore((s) => s.availableSkills);
  const activeSkillNames = useSkillStore((s) => s.activeSkillNames);
  const activeSkillTokens = useSkillStore((s) => s.activeSkillTokens);
  const activateSkill = useSkillStore((s) => s.activateSkill);
  const deactivateSkill = useSkillStore((s) => s.deactivateSkill);
  const isLoading = useSkillStore((s) => s.isLoading);

  const [expanded, setExpanded] = useState(false);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);

  const agent = useAgentStore((s) => s.agents.find((a) => a.id === agentId));
  const currentConversationId = useConversationStore((s) => s.currentConversationId);

  const handleToggle = useCallback(
    async (skillName: string) => {
      if (!agent) return;
      setTogglingSkill(skillName);
      try {
        if (activeSkillNames.includes(skillName)) {
          await deactivateSkill(skillName, currentConversationId ?? undefined);
        } else {
          await activateSkill(agent.folder_name, skillName, currentConversationId ?? undefined);
        }
      } finally {
        setTogglingSkill(null);
      }
    },
    [agent, activeSkillNames, activateSkill, deactivateSkill, currentConversationId],
  );

  if (availableSkills.length === 0) return null;

  const tokenClass =
    activeSkillTokens >= 3000
      ? "skill-token-danger"
      : activeSkillTokens >= 2000
        ? "skill-token-warn"
        : "skill-token-normal";

  return (
    <div className="skill-bar">
      <button
        className="skill-bar-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>
          {isLoading ? t("skills.skillLoading") : t("skills.skillCount", { count: activeSkillNames.length })}
        </span>
      </button>

      {expanded && (
        <div className="skill-bar-content">
          <div className="skill-chips">
            {availableSkills.map((skill) => (
              <SkillChip
                key={skill.name}
                skill={skill}
                isActive={activeSkillNames.includes(skill.name)}
                isLoading={togglingSkill === skill.name}
                onToggle={handleToggle}
              />
            ))}
          </div>
          <div className={`skill-token-indicator ${tokenClass}`}>
            {t("skills.tokenCount", { tokens: activeSkillTokens })}
          </div>
        </div>
      )}
    </div>
  );
}
