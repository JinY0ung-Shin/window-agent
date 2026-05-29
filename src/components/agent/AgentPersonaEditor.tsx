import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import { useSettingsStore } from "../../stores/settingsStore";
import type { PersonaTab } from "../../stores/agentStore";
import type { PersonaFiles } from "../../services/types";

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
  const { t } = useTranslation("glossary");
  const ta = useTranslation("agent").t;
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const { compositionProps } = useCompositionInput((v) => onFileChange(personaTab, v));
  const placeholders: Record<string, string> = {
    identity: t("personaIdentityPlaceholder", { context: uiTheme }),
    soul: t("personaSoulPlaceholder", { context: uiTheme }),
    user: t("personaUserPlaceholder", { context: uiTheme }),
    agents: t("personaAgentsPlaceholder", { context: uiTheme }),
  };
  const tabLabels: Record<string, string> = {
    identity: t("personaIdentity", { context: uiTheme }),
    soul: t("personaSoul", { context: uiTheme }),
    user: t("personaUser", { context: uiTheme }),
    agents: t("personaAgents", { context: uiTheme }),
  };

  return (
    <textarea
      className="persona-editor"
      value={personaFiles?.[personaTab] ?? ""}
      placeholder={placeholders[personaTab] ?? ""}
      aria-label={ta("persona.editorAriaLabel", { tab: tabLabels[personaTab] ?? personaTab })}
      spellCheck={false}
      {...compositionProps}
    />
  );
}
