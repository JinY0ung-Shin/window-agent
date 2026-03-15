// ── UI Label System ─────────────────────────────────
// Supports two UI themes: "classic" (original agent terminology)
// and "org" (organization/company metaphor).

export type UITheme = "classic" | "org";

export interface Labels {
  // ── App ──
  appTitle: (companyName: string) => string;

  // ── Entity ──
  agent: string;
  agents: string;
  defaultAgentTitle: string;

  // ── Actions ──
  newAgent: string;
  newAgentDescription: string;
  hire: string;
  deleteAgent: string;
  editAgent: string;
  selectAgent: string;
  selectAgentDescription: string;

  // ── Bootstrap ──
  bootstrapTitle: string;
  bootstrapPrompt: string;
  bootstrapInProgress: string;

  // ── Badges ──
  badgeDefault: string;
  badgeDormant: string;

  // ── Skills ──
  skill: string;
  skills: string;
  newSkill: string;
  skillCount: (n: number) => string;
  skillLoading: string;
  noSkills: string;
  sharedSkills: string;
  deleteSkillConfirm: string;
  skillNamePlaceholder: string;

  // ── Slash commands ──
  slashSkillUsage: string;
  slashSkillEquipped: (name: string) => string;
  slashSkillUnequipped: (name: string) => string;
  slashSkillAvailable: string;
  slashSkillFailed: (name: string, err: string) => string;

  // ── Editor ──
  editorTitle: string;
  editorNewTitle: string;
  agentNamePlaceholder: string;
  agentDescPlaceholder: string;

  // ── Persona tabs ──
  personaIdentity: string;
  personaSoul: string;
  personaUser: string;
  personaAgents: string;
  personaTools: string;
  personaIdentityPlaceholder: string;
  personaSoulPlaceholder: string;
  personaUserPlaceholder: string;
  personaAgentsPlaceholder: string;

  // ── Export/Import ──
  exportAgent: string;
  importAgent: string;
  selectAgentExport: string;

  // ── Conversation ──
  newConversation: string;
  clearChat: string;

  // ── Memory ──
  memoryNote: string;

  // ── Tools ──
  memoryNoteToolDesc: string;

  // ── Sidebar ──
  sidebarNewButton: string;

  // ── Chat ──
  chatWelcome: string;
  chatSelectOrHire: string;

  // ── Errors ──
  agentSaveFailed: (err: string) => string;
  settingsSaveFailed: (err: string) => string;

  // ── Tool editor ──
  toolAgentCapability: string;

  // ── Chat flow ──
  noAgentForSkill: string;
  maxToolIterations: string;
  bootstrapFailed: (err: string) => string;
}

const CLASSIC: Labels = {
  // ── App ──
  appTitle: (name) => name || "Agent Workspace",

  // ── Entity ──
  agent: "에이전트",
  agents: "에이전트",
  defaultAgentTitle: "매니저",

  // ── Actions ──
  newAgent: "새 에이전트",
  newAgentDescription: "대화로 새 에이전트의 페르소나를 만듭니다",
  hire: "새 에이전트",
  deleteAgent: "에이전트 삭제",
  editAgent: "에이전트 편집",
  selectAgent: "에이전트 선택",
  selectAgentDescription: "대화할 에이전트를 선택하세요",

  // ── Bootstrap ──
  bootstrapTitle: "새 에이전트 만들기",
  bootstrapPrompt: "어떤 에이전트를 만들고 싶나요? 이름, 성격, 역할 등을 알려주세요.",
  bootstrapInProgress: "에이전트 생성 중...",

  // ── Badges ──
  badgeDefault: "MANAGER",
  badgeDormant: "Dormant",

  // ── Skills ──
  skill: "스킬",
  skills: "스킬",
  newSkill: "새 스킬 추가",
  skillCount: (n) => `스킬 ${n}개 활성`,
  skillLoading: "스킬 로딩...",
  noSkills: "아직 스킬이 없습니다",
  sharedSkills: "공유 스킬 (읽기 전용)",
  deleteSkillConfirm: "스킬을 삭제하시겠습니까?",
  skillNamePlaceholder: "스킬 이름 (예: code-review)",

  // ── Slash commands ──
  slashSkillUsage: "사용법: /skill [equip|unequip] [이름]\n예: /skill equip code-review",
  slashSkillEquipped: (name) => `스킬 "${name}" 장착 완료`,
  slashSkillUnequipped: (name) => `스킬 "${name}" 해제 완료`,
  slashSkillAvailable: "사용 가능한 스킬:",
  slashSkillFailed: (name, err) => `스킬 "${name}" 장착 실패: ${err}`,

  // ── Editor ──
  editorTitle: "에이전트 편집",
  editorNewTitle: "새 에이전트",
  agentNamePlaceholder: "에이전트 이름",
  agentDescPlaceholder: "에이전트 설명 (한 줄)",

  // ── Persona tabs ──
  personaIdentity: "IDENTITY",
  personaSoul: "SOUL",
  personaUser: "USER",
  personaAgents: "AGENTS",
  personaTools: "TOOLS",
  personaIdentityPlaceholder: "이름, 역할, 스타일을 정의합니다 (명함)",
  personaSoulPlaceholder: "핵심 성격, 가치관, 경계선을 정의합니다 (영혼)",
  personaUserPlaceholder: "사용자 이름, 호칭, 선호도를 정의합니다 (사용자 프로필)",
  personaAgentsPlaceholder: "업무 방식, 응답 형식, 도구 규칙을 정의합니다 (업무 매뉴얼)",

  // ── Export/Import ──
  exportAgent: "에이전트 내보내기",
  importAgent: "에이전트 불러오기",
  selectAgentExport: "에이전트 선택...",

  // ── Conversation ──
  newConversation: "새 대화",
  clearChat: "대화 초기화",

  // ── Memory ──
  memoryNote: "메모리 노트",

  // ── Tools ──
  memoryNoteToolDesc: "에이전트 메모리 노트를 관리합니다",

  // ── Sidebar ──
  sidebarNewButton: "새 에이전트",

  // ── Chat ──
  chatWelcome: "Agent Workspace",
  chatSelectOrHire: "사이드바에서 에이전트를 선택하거나 새 에이전트를 만들어 보세요",

  // ── Errors ──
  agentSaveFailed: (err) => `에이전트 저장 실패: ${err}`,
  settingsSaveFailed: (err) => `설정 저장 실패: ${err}`,

  // ── Tool editor ──
  toolAgentCapability: "도구를 추가하면 에이전트가 외부 기능을 실행할 수 있습니다.",

  // ── Chat flow ──
  noAgentForSkill: "현재 에이전트를 찾을 수 없습니다",
  maxToolIterations: "최대 도구 호출 반복 횟수에 도달했습니다.",
  bootstrapFailed: (err) => `에이전트 생성에 실패했습니다: ${err}. 다시 시도하거나 취소 버튼을 눌러주세요.`,
};

const ORG: Labels = {
  // ── App ──
  appTitle: (name) => name || "우리 회사",

  // ── Entity ──
  agent: "직원",
  agents: "직원",
  defaultAgentTitle: "팀장",

  // ── Actions ──
  newAgent: "채용하기",
  newAgentDescription: "채용 과정을 통해 새 직원을 만듭니다",
  hire: "채용하기",
  deleteAgent: "해고하기",
  editAgent: "인사 관리",
  selectAgent: "직원 선택",
  selectAgentDescription: "누구와 이야기하시겠습니까?",

  // ── Bootstrap ──
  bootstrapTitle: "채용하기",
  bootstrapPrompt: "어떤 직원을 채용하고 싶으신가요? 이름, 성격, 담당 업무 등을 알려주세요.",
  bootstrapInProgress: "채용 진행 중...",

  // ── Badges ──
  badgeDefault: "팀장",
  badgeDormant: "휴직",

  // ── Skills ──
  skill: "스킬",
  skills: "스킬",
  newSkill: "새 스킬 추가",
  skillCount: (n) => `스킬 ${n}개 활성`,
  skillLoading: "스킬 로딩...",
  noSkills: "아직 스킬이 없습니다",
  sharedSkills: "공유 스킬 (읽기 전용)",
  deleteSkillConfirm: "스킬을 삭제하시겠습니까?",
  skillNamePlaceholder: "스킬 이름 (예: code-review)",

  // ── Slash commands ──
  slashSkillUsage: "사용법: /skill [equip|unequip] [이름]\n예: /skill equip code-review",
  slashSkillEquipped: (name) => `스킬 "${name}" 장착 완료`,
  slashSkillUnequipped: (name) => `스킬 "${name}" 해제 완료`,
  slashSkillAvailable: "사용 가능한 스킬:",
  slashSkillFailed: (name, err) => `스킬 "${name}" 장착 실패: ${err}`,

  // ── Editor ──
  editorTitle: "인사 관리",
  editorNewTitle: "신규 채용",
  agentNamePlaceholder: "직원 이름",
  agentDescPlaceholder: "직무 요약 (한 줄)",

  // ── Persona tabs ──
  personaIdentity: "신상정보",
  personaSoul: "성격/가치관",
  personaUser: "상사 정보",
  personaAgents: "업무 규칙",
  personaTools: "업무 도구",
  personaIdentityPlaceholder: "이름, 직급, 역할을 정의합니다 (신상정보)",
  personaSoulPlaceholder: "핵심 성격, 가치관, 경계선을 정의합니다 (성격/가치관)",
  personaUserPlaceholder: "상사(사용자) 이름, 호칭, 선호도를 정의합니다 (상사 정보)",
  personaAgentsPlaceholder: "업무 방식, 응답 형식, 도구 규칙을 정의합니다 (업무 규칙)",

  // ── Export/Import ──
  exportAgent: "직원 내보내기",
  importAgent: "영입하기",
  selectAgentExport: "직원 선택...",

  // ── Conversation ──
  newConversation: "새 대화",
  clearChat: "대화 초기화",

  // ── Memory ──
  memoryNote: "업무 일지",

  // ── Tools ──
  memoryNoteToolDesc: "직원 업무 일지를 관리합니다",

  // ── Sidebar ──
  sidebarNewButton: "채용하기",

  // ── Chat ──
  chatWelcome: "",  // Uses companyName via appTitle()
  chatSelectOrHire: "직원을 선택하거나 새로 채용하세요",

  // ── Errors ──
  agentSaveFailed: (err) => `직원 저장 실패: ${err}`,
  settingsSaveFailed: (err) => `설정 저장 실패: ${err}`,

  // ── Tool editor ──
  toolAgentCapability: "도구를 추가하면 직원이 외부 기능을 실행할 수 있습니다.",

  // ── Chat flow ──
  noAgentForSkill: "현재 직원을 찾을 수 없습니다",
  maxToolIterations: "최대 도구 호출 반복 횟수에 도달했습니다.",
  bootstrapFailed: (err) => `직원 생성에 실패했습니다: ${err}. 다시 시도하거나 취소 버튼을 눌러주세요.`,
};

const THEME_MAP: Record<UITheme, Labels> = { classic: CLASSIC, org: ORG };

/**
 * Pure label resolver — usable from stores, helpers, and components.
 */
export function getLabels(theme: UITheme = "org"): Labels {
  return THEME_MAP[theme];
}
