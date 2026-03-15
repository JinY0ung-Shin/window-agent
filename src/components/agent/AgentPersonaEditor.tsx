import type { PersonaTab } from "../../stores/agentStore";
import type { PersonaFiles } from "../../services/types";

const PERSONA_TABS: { key: PersonaTab; label: string }[] = [
  { key: "identity", label: "IDENTITY" },
  { key: "soul", label: "SOUL" },
  { key: "user", label: "USER" },
  { key: "agents", label: "AGENTS" },
];

const TAB_PLACEHOLDERS: Record<Exclude<PersonaTab, "tools">, string> = {
  identity: "이름, 역할, 스타일을 정의합니다 (명함)",
  soul: "핵심 성격, 가치관, 경계선을 정의합니다 (영혼)",
  user: "사용자 이름, 호칭, 선호도를 정의합니다 (사용자 프로필)",
  agents: "업무 방식, 응답 형식, 도구 규칙을 정의합니다 (업무 매뉴얼)",
};

export { PERSONA_TABS };

interface Props {
  personaFiles: PersonaFiles | null;
  personaTab: PersonaTab;
  onFileChange: (tab: PersonaTab, content: string) => void;
}

export default function AgentPersonaEditor({ personaFiles, personaTab, onFileChange }: Props) {
  return (
    <textarea
      className="persona-editor"
      value={personaFiles?.[personaTab] ?? ""}
      onChange={(e) => onFileChange(personaTab, e.target.value)}
      placeholder={TAB_PLACEHOLDERS[personaTab as Exclude<PersonaTab, "tools">]}
      spellCheck={false}
    />
  );
}
