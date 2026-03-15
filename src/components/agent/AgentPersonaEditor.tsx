import type { PersonaTab } from "../../stores/agentStore";
import type { PersonaFiles } from "../../services/types";
import { useLabels } from "../../hooks/useLabels";

const PERSONA_TABS: { key: PersonaTab; label: string }[] = [
  { key: "identity", label: "IDENTITY" },
  { key: "soul", label: "SOUL" },
  { key: "user", label: "USER" },
  { key: "agents", label: "AGENTS" },
];


export { PERSONA_TABS };

interface Props {
  personaFiles: PersonaFiles | null;
  personaTab: PersonaTab;
  onFileChange: (tab: PersonaTab, content: string) => void;
}

export default function AgentPersonaEditor({ personaFiles, personaTab, onFileChange }: Props) {
  const labels = useLabels();
  const placeholders: Record<string, string> = {
    identity: labels.personaIdentityPlaceholder,
    soul: labels.personaSoulPlaceholder,
    user: labels.personaUserPlaceholder,
    agents: labels.personaAgentsPlaceholder,
  };

  return (
    <textarea
      className="persona-editor"
      value={personaFiles?.[personaTab] ?? ""}
      onChange={(e) => onFileChange(personaTab, e.target.value)}
      placeholder={placeholders[personaTab] ?? ""}
      spellCheck={false}
    />
  );
}
