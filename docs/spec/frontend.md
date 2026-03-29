# Frontend Structure Specification

> Window Agent의 프론트엔드 아키텍처. React 19 + TypeScript + Zustand + i18next + Vite 기반.

---

## 1. Zustand Store 전체 목록 (24개)

모든 스토어는 `src/stores/` 디렉토리에 위치하며, `create()` (zustand) 패턴으로 생성된다.

| # | Store | 파일 | 핵심 상태 | 핵심 액션 |
|---|-------|------|----------|----------|
| 1 | **agentStore** | agentStore.ts | agents[], selectedAgentId, isEditorOpen, editingAgentId, personaFiles, toolConfig | loadAgents, openEditor, saveAgent, deleteAgent, loadToolConfig, saveToolConfig |
| 2 | **bootstrapStore** | bootstrapStore.ts | isBootstrapping, bootstrapFolderName, bootstrapApiHistory, bootstrapFilesWritten, isOnboarding | startBootstrap, cancelBootstrap, resetBootstrap, finishOnboarding |
| 3 | **chatFlowStore** | chatFlowStore.ts | (chatFlowCore + toolExecution + streamResponses 조합) | sendMessage, runToolLoop, streamOneTurn, saveFinalResponse |
| 4 | **chatFlowCore** | chatFlowCore.ts | (순수 함수 모듈) | resolveAgentForConversation, ensureConversation, resolveEffectiveSettings, resolveSystemPrompt, resolveWorkspacePath, estimateContextTokens |
| 5 | **conversationStore** | conversationStore.ts | conversations[], currentConversationId, currentLearningMode, consolidatedMemory | loadConversations, openAgentChat, deleteConversation, toggleLearningMode, loadConsolidatedMemory, initConsolidationRecovery |
| 6 | **cronStore** | cronStore.ts | jobs[], selectedJobId, isEditorOpen, editingJobId, runs[] | loadJobs, createJob, updateJob, deleteJob, toggleJob, loadRuns, setupListeners |
| 7 | **debugStore** | debugStore.ts | logs[] (ToolCallLog), httpLogs[] (HttpLogEntry), activeTab, isOpen, filterByTool, filterByStatus | loadLogs, setOpen, setActiveTab |
| 8 | **memoryStore** | memoryStore.ts | notes[] (MemoryNote), currentAgentId | loadNotes, addNote, editNote, removeNote |
| 9 | **messageStore** | messageStore.ts | messages[] (ChatMessage), inputValue, pendingAttachments[] (max 4) | setInputValue, setMessages, appendMessage, updateMessage, clearMessages, addPendingAttachment |
| 10 | **navigationStore** | navigationStore.ts | mainView (MainView), previousView | setMainView, toggleView, goBack |
| 11 | **networkStore** | networkStore.ts | status (NetworkStatus), peerId, networkEnabled, contacts[], threads[], messages[], selectedContactId, selectedThreadId, showAllMessages, directoryResults | initialize, setupEventListeners, toggleNetwork, loadContacts, sendMessage, loadThreadMessages, searchDirectory |
| 12 | **settingsStore** | settingsStore.ts | hasApiKey, hasStoredKey, baseUrl, modelName, thinkingEnabled, thinkingBudget, uiTheme, companyName, brandingInitialized, locale, appReady | loadSettings, loadEnvDefaults, saveSettings, setUITheme, setLocale, initializeBranding, saveOnboardingApiConfig |
| 13 | **skillStore** | skillStore.ts | availableSkills[], activeSkillBodies{}, activeSkillNames[], activeSkillTokens, catalogPrompt | loadSkills, activateSkill, deactivateSkill, restoreActiveSkills, getSkillsPromptSection |
| 14 | **streamStore** | streamStore.ts | activeRun (ActiveRun), isStreaming | setActiveRun, clearActiveRun + shelveActiveRun, unshelveStream (모듈 함수) |
| 15 | **streamResponses** | streamResponses.ts | (순수 함수 모듈) | streamOneTurn, saveFinalResponse, saveAssistantToolCallMessage, handleStreamAbort, handleMaxIterations |
| 16 | **summaryStore** | summaryStore.ts | currentSummary, summaryUpToMessageId, summaryJobId | setSummary, resetSummary, loadSummary, maybeGenerateSummary |
| 17 | **teamStore** | teamStore.ts | teams[], selectedTeamId, isTeamEditorOpen, editingTeamId | loadTeams, createTeam, updateTeam, deleteTeam, addMember, removeMember, getTeamDetail |
| 18 | **teamRunStore** | teamRunStore.ts | activeRuns{}, tasksByRun{} | addRun, updateRunStatus, removeRun, addTask, updateTaskStatus, setupListeners |
| 19 | **teamChatFlowStore** | teamChatFlowStore.ts | (팀 채팅 전용 스트리밍) | sendTeamMessage, handleTeamStream |
| 20 | **toolExecution** | toolExecution.ts | (순수 함수 모듈) | runToolLoop, classifyToolCalls, executeToolPipeline |
| 21 | **toolRunStore** | toolRunStore.ts | toolRunStates{}, pendingToolCallsByRun{}, toolRunState, pendingToolCalls | approveToolCall, rejectToolCall, setPending, setRunning, setWaiting, waitForToolApproval |
| 22 | **tourStore** | tourStore.ts | tourPending, tourCompleted + TOUR_STEPS (5단계) | setTourPending, completeTour, startTour |
| 23 | **vaultStore** | vaultStore.ts | notes[] (VaultNoteSummary), graph, selectedNote, searchResults, activeAgent, activeCategory, activeTags | loadNotes, loadGraph, createNote, updateNote, deleteNote, search, selectNote, openInObsidian |
| 24 | **resetHelper** | resetHelper.ts | (유틸리티 모듈) | resetChatContext, resetTransientChatState |

---

## 2. Component 구조

```
src/components/
├── agent/          # 에이전트 관리
│   ├── AgentPanel.tsx            에이전트 목록 + 관리 패널
│   ├── AgentEditor.tsx           에이전트 편집 (메타데이터 + 페르소나 + 도구)
│   ├── AgentMetadataForm.tsx     이름/설명/아바타/모델 설정
│   ├── AgentPersonaEditor.tsx    페르소나 파일 탭 에디터
│   ├── AgentSkillsPanel.tsx      스킬 목록 + 마켓플레이스 설치
│   ├── AvatarUploader.tsx        아바타 이미지 업로드/리사이즈
│   ├── CredentialPanel.tsx       자격증명 CRUD
│   ├── MarketplacePanel.tsx      마켓플레이스 플러그인 검색/설치
│   └── NativeToolPanel.tsx       네이티브 도구 허용/차단 설정
│
├── chat/           # 채팅 시스템
│   ├── ChatWindow.tsx            메인 채팅 뷰 (메시지 목록 + 입력)
│   ├── ChatInput.tsx             메시지 입력 (텍스트 + 첨부 + 전송)
│   ├── ChatMessage.tsx           개별 메시지 렌더링
│   ├── MessageBody.tsx           메시지 본문 (Markdown + 코드 블록)
│   ├── ConversationSwitcher.tsx  대화 전환 드롭다운
│   ├── OnboardingAnimation.tsx   부트스트랩 애니메이션
│   ├── ToolCallBubble.tsx        도구 호출 UI 버블
│   ├── ToolResultDetail.tsx      도구 결과 상세
│   ├── ToolRunBlock.tsx          도구 실행 블록 (승인/거절 UI)
│   ├── ToolRunGroup.tsx          연속 도구 실행 그룹
│   ├── ToolRunStepList.tsx       도구 실행 단계 목록
│   ├── chatRenderBlocks.ts       메시지 → 렌더 블록 변환
│   └── toolCallUtils.ts          도구 호출 유틸리티
│
├── team/           # 팀 시스템
│   ├── TeamPanel.tsx             팀 목록 + 관리
│   ├── TeamEditor.tsx            팀 생성/편집 (리더 + 멤버 선택)
│   ├── TeamChatWindow.tsx        팀 채팅 뷰 (위임 상태 표시)
│   ├── TeamChatInput.tsx         팀 채팅 입력
│   └── TeamStatusBar.tsx         팀 실행 상태 바 (태스크 진행률)
│
├── cron/           # 크론 시스템
│   ├── CronPanel.tsx             크론 작업 목록 + 실행 이력
│   └── CronEditor.tsx            크론 작업 생성/편집
│
├── vault/          # Vault (Knowledge Graph)
│   ├── VaultPanel.tsx            Vault 메인 레이아웃
│   ├── VaultHeader.tsx           Vault 헤더 (에이전트 선택)
│   ├── VaultEmptyState.tsx       빈 상태 안내
│   ├── NoteListPane.tsx          노트 목록 패널
│   ├── NoteListItem.tsx          개별 노트 항목
│   ├── NoteFilterBar.tsx         카테고리/태그 필터
│   ├── NoteSearchBar.tsx         노트 검색
│   ├── NoteDetailPane.tsx        노트 상세 (읽기 + 편집)
│   ├── NoteContent.tsx           노트 본문 렌더링
│   ├── NoteEditor.tsx            노트 편집기
│   ├── NoteEditorToolbar.tsx     편집 툴바
│   ├── NoteMetadataBar.tsx       노트 메타데이터 (타입/태그/신뢰도)
│   ├── BacklinksSection.tsx      역참조 링크 표시
│   ├── CreateNoteDialog.tsx      새 노트 생성 다이얼로그
│   ├── GraphPane.tsx             그래프 뷰 패널
│   └── GraphCanvas.tsx           그래프 캔버스 (노드/엣지 시각화)
│
├── network/        # 릴레이 네트워크
│   ├── NetworkPanel.tsx          네트워크 메인 패널
│   ├── ContactList.tsx           연락처 목록
│   ├── ContactDetail.tsx         연락처 상세 (설정/권한)
│   ├── PeerThread.tsx            피어 대화 스레드
│   ├── PeerChatInput.tsx         피어 메시지 입력 (에이전트 드롭다운)
│   ├── PeerMessageBubble.tsx     피어 메시지 버블
│   ├── InviteDialog.tsx          초대 코드 생성/수락
│   └── DeliveryBadge.tsx         메시지 전달 상태 뱃지
│
├── memory/         # 메모리 관리
│   └── MemoryPanel.tsx           메모리 노트 CRUD (에이전트별)
│
├── settings/       # 설정
│   ├── SettingsModal.tsx         설정 모달 (메인 컨테이너)
│   ├── GeneralSettingsPanel.tsx  일반 설정 (테마, 회사명, 로케일)
│   ├── ApiServerSection.tsx      API 서버 (키, URL, 모델)
│   ├── ThinkingSettingsPanel.tsx Thinking 모드
│   ├── BrandingSettingsPanel.tsx 브랜딩 설정
│   ├── NetworkSettingsPanel.tsx  네트워크 설정 메인
│   ├── NetworkToggleSection.tsx  릴레이 네트워크 토글
│   ├── RelayConfigSection.tsx    릴레이 서버 URL
│   ├── RelayToolsSection.tsx     릴레이 허용 도구
│   ├── ProxySection.tsx          프록시/NO_PROXY
│   ├── CredentialManager.tsx     자격 증명 관리
│   └── ExportSection.tsx         에이전트 내보내기/가져오기
│
├── layout/         # 레이아웃
│   ├── MainLayout.tsx            메인 레이아웃 (사이드바 + 뷰 라우팅)
│   ├── Sidebar.tsx               사이드바 (에이전트 목록 + 네비게이션)
│   ├── DraggableHeader.tsx       드래그 가능한 타이틀바 영역
│   └── WindowControls.tsx        창 컨트롤 (최소화/최대화/닫기)
│
├── onboarding/     # 온보딩
│   └── OnboardingScreen.tsx      4단계 온보딩 화면
│
├── tour/           # 가이드 투어
│   └── TourOverlay.tsx           투어 오버레이 (하이라이트 + 설명)
│
├── skill/          # 스킬 관리
│   ├── SkillBar.tsx              활성 스킬 바
│   └── SkillChip.tsx             스킬 칩 (활성/비활성 토글)
│
├── debug/          # 디버그
│   └── DebugPanel.tsx            디버그 패널 (도구 로그 + HTTP 로그)
│
└── common/         # 공통 컴포넌트
    ├── Modal.tsx                 범용 모달
    ├── ErrorBoundary.tsx         에러 바운더리
    └── EmptyState.tsx            빈 상태 표시
```

---

## 3. Services 구조

### 3.1 Commands (Tauri invoke 래퍼)

`src/services/commands/` 디렉토리에 도메인별로 분리. `tauriCommands.ts`가 모든 모듈을 re-export.

| 파일 | 도메인 | 주요 함수 |
|------|--------|----------|
| agentCommands.ts | Agent | listAgents, createAgent, updateAgent, deleteAgent, writeAgentFile, readAgentFile, syncAgentsFromFs, seedManagerAgent, refreshDefaultManagerPersona, resizeAvatar, getBootstrapPrompt |
| apiCommands.ts | API/LLM | hasApiKey, hasStoredKey, setApiConfig, checkApiHealth, chatCompletion, chatCompletionStream, abortStream, bootstrapCompletion, listModels, getAppSettings, setAppSettings, migrateFrontendSettings, getEnvConfig, getNoProxy, setNoProxy |
| browserCommands.ts | Browser | approveBrowserDomain, getBrowserArtifact, getBrowserHeadless, setBrowserHeadless, getBrowserProxy, setBrowserProxy, getBrowserNoProxy, setBrowserNoProxy, detectSystemProxy, detectSystemNoProxy |
| chatCommands.ts | Conversation | createConversation, createTeamConversation, getConversations, getConversationDetail, updateConversationSummary, deleteConversation, setLearningMode, updateConversationSkills, getMessages, saveMessage, deleteMessagesAndMaybeResetSummary, updateConversationTitle |
| credentialCommands.ts | Credential | listCredentials, addCredential, updateCredential, removeCredential |
| cronCommands.ts | Cron | createCronJob, listCronJobs, listCronJobsForAgent, getCronJob, updateCronJob, deleteCronJob, toggleCronJob, listCronRuns |
| marketplaceCommands.ts | Marketplace | marketplaceFetchPlugins, marketplaceFetchPluginSkills, marketplaceInstallSkills |
| memoryCommands.ts | Memory | createMemoryNote, listMemoryNotes, updateMemoryNote, deleteMemoryNote, readConsolidatedMemory, writeConsolidatedMemory, readDigest, writeDigest, updateConversationDigest, updateConversationConsolidated, listPendingConsolidations, archiveConversationNotes |
| relayCommands.ts | Relay/Network | relayStart, relayStop, relayStatus, relayGetPeerId, relayGenerateInvite, relayAcceptInvite, relayListContacts, relayUpdateContact, relayRemoveContact, relayApproveContact, relayRejectContact, relayBindAgent, relaySendMessage, relayListThreads, relayGetThread, relayGetThreadMessages, relayDeleteThread, relayClearThreadMessages, relayGetNetworkEnabled, relaySetNetworkEnabled, relayGetConnectionInfo, relayGetRelayUrl, relaySetRelayUrl, relayGetAllowedTools, relaySetAllowedTools, relaySearchDirectory, relaySendFriendRequest, relayUpdateDirectoryProfile, relayGetDirectorySettings, relaySetDirectorySettings |
| skillCommands.ts | Skill | listSkills, readSkill, readSkillResource, createSkill, updateSkill, deleteSkill |
| teamCommands.ts | Team | createTeam, getTeamDetail, listTeams, updateTeam, deleteTeam, addTeamMember, removeTeamMember, createTeamRun, updateTeamRunStatus, getTeamRun, getRunningRuns, createTeamTask, updateTeamTask, getTeamTasks, abortTeamRun, executeDelegation, handleTeamReport |
| toolCommands.ts | Tool | executeTool, createToolCallLog, listToolCallLogs, updateToolCallLogStatus, getNativeTools, getDefaultToolConfig, readToolConfig, writeToolConfig |
| vaultCommands.ts | Vault | vaultCreateNote, vaultReadNote, vaultUpdateNote, vaultDeleteNote, vaultListNotes, vaultSearch, vaultGetGraph, vaultGetBacklinks, vaultGetPath, vaultOpenInObsidian, vaultRebuildIndex, vaultArchiveNote, vaultListNotesWithDecay |

### 3.2 비즈니스 로직 서비스

| 파일 | 역할 |
|------|------|
| bootstrapService.ts | 에이전트 부트스트랩 (LLM으로 persona 파일 자동 생성) |
| browserApprovalService.ts | 브라우저 도메인 승인 (URL에서 도메인 추출 + 승인 호출) |
| chatHelpers.ts | 메시지 빌드 (buildConversationContext, buildChatMessages) |
| consolidationService.ts | 대화 요약/통합 (generateDigest + consolidateMemory) |
| conversationLifecycle.ts | 대화 생성/삭제/전환 라이프사이클 |
| heartbeatService.ts | 주기적 헬스체크 (세션 시작/종료 이벤트 기반) |
| initService.ts | 앱 초기화 (설정 로드 + 에이전트 시딩 + 온보딩) |
| lifecycleEvents.ts | 라이프사이클 이벤트 시스템 (app:init, app:ready, session:start/end) |
| logger.ts | 로깅 유틸리티 |
| memoryAdapter.ts | 메모리 시스템 어댑터 |
| nativeToolRegistry.ts | 네이티브 도구 설정 읽기/쓰기 (TOOL_CONFIG.json) |
| personaService.ts | 페르소나 파일 관리 (읽기/쓰기/시스템 프롬프트 조립) |
| preCompactService.ts | Pre-compaction (토큰 초과 시 메시지 압축) |
| streamHelpers.ts | 스트리밍 유틸리티 (SSE 파싱, 메시지 빌드, 도구 분류/실행) |
| tokenEstimator.ts | 토큰 추정 (문자열/메시지 배열) |
| toolRegistry.ts | 도구 등록/관리 (getEffectiveTools, toOpenAITools) |
| toolService.ts | 도구 실행 서비스 |
| types.ts | 공유 TypeScript 타입 정의 |
| vaultTypes.ts | Vault 관련 타입 정의 |

---

## 4. Custom Hooks (8개)

`src/hooks/` 디렉토리에 위치.

| Hook | 파일 | 역할 | 주요 로직 |
|------|------|------|----------|
| **useAgentEditor** | useAgentEditor.ts | 에이전트 편집 로직 캡슐화 | persona 로드, 저장, 유효성 검사, 에디터 상태 관리 |
| **useAttachmentSrc** | useAttachmentSrc.ts | 첨부파일 소스 관리 | DB 경로 → `readFileBase64` → data URL 변환 |
| **useChatInputLogic** | useChatInputLogic.ts | 채팅 입력 처리 | Enter/Shift+Enter 분기, 전송 핸들러, 첨부파일 처리 |
| **useClipboardFeedback** | useClipboardFeedback.ts | 클립보드 복사 피드백 | 복사 후 일시적 "복사됨" 상태 표시 (자동 리셋) |
| **useCompositionInput** | useCompositionInput.ts | 한글 입력 조합(IME) 처리 | compositionStart/End 이벤트로 Enter 전송 방지 |
| **useDragRegion** | useDragRegion.ts | Tauri 창 드래그 영역 | `startDragging()` + 더블클릭 최대화 토글 |
| **useLoadOnOpen** | useLoadOnOpen.ts | 컴포넌트 열림 시 데이터 로드 | isOpen 상태 변화 시 자동 fetch |
| **useMessageScroll** | useMessageScroll.ts | 메시지 영역 자동 스크롤 | 새 메시지/스트리밍 시 하단 스크롤, 수동 스크롤 감지 |

---

## 5. i18n 구조

### 5.1 설정

- **라이브러리**: i18next + react-i18next
- **초기화**: `src/i18n/config.ts`
- **기본 언어**: `ko` (한국어)
- **폴백 언어**: `ko`
- **로케일 저장**: localStorage (`locale` 키) + backend store

### 5.2 지원 언어

| 코드 | 언어 |
|------|------|
| `ko` | 한국어 |
| `en` | 영어 |

### 5.3 Namespaces (11개)

| Namespace | 용도 |
|-----------|------|
| `common` | 공통 UI 문구 (기본 NS) |
| `glossary` | 테마별 용어 (agent, agents + context suffix) |
| `settings` | 설정 화면 |
| `onboarding` | 온보딩 화면 |
| `agent` | 에이전트 관리 |
| `chat` | 채팅 화면 |
| `network` | 네트워크/릴레이 |
| `vault` | Vault 화면 |
| `prompts` | 시스템 프롬프트 |
| `team` | 팀 관리 |
| `cron` | 크론 관리 |

### 5.4 한국어 조사 자동 처리

i18next의 `interpolation.format` 커스텀 함수로 한국어 조사를 자동 선택한다.

```typescript
// i18n config.ts
format: (value, format, lng) => {
    // 지원 조사: 이/가, 을/를, 은/는, 과/와, 으로/로
    // 마지막 글자의 유니코드 종성 유무로 판별
    const code = value.charCodeAt(value.length - 1);
    // 한글 음절: U+AC00 ~ U+D7A3
    // (code - 0xAC00) % 28 !== 0 → 종성 있음 → 첫 번째 조사
}
```

사용 예:
```json
{ "agentDeleted": "{{name, 이/가}} 삭제되었습니다" }
```

### 5.5 테마 변수 (`themeVars.ts`)

`syncThemeVars(i18n, theme)` 함수가 glossary의 `term_*` 키에서 테마별 값을 추출하여 모든 namespace에서 사용할 수 있는 보간 변수로 주입한다.

| 변수 | 예시 (org) | 예시 (classic) |
|------|-----------|---------------|
| `{{term_agent}}` | 직원 | 에이전트 |
| `{{term_agent_cap}}` | 직원 | 에이전트 |
| `{{term_agents}}` | 직원들 | 에이전트들 |
| `{{term_agents_cap}}` | 직원들 | 에이전트들 |

---

## 6. 네비게이션 구조

### 6.1 MainView 타입

```typescript
type MainView = "chat" | "network" | "vault" | "team" | "cron" | "agent" | "settings";
```

### 6.2 navigationStore 동작

| 액션 | 설명 |
|------|------|
| `setMainView(view)` | 뷰 전환. `"settings"`는 localStorage에 저장하지 않음 (transient) |
| `toggleView(view)` | 현재 뷰와 같으면 `"chat"`으로 전환, 다르면 해당 뷰로 전환 |
| `goBack()` | `previousView`로 복귀. `"settings"`이면 `"chat"`으로 대체 |

- 초기값: localStorage의 `main_view` 키에서 복원 (기본: `"chat"`)
- `VALID_VIEWS` 배열로 유효성 검증

### 6.3 MainLayout 라우팅

```
MainLayout
  ├─ Sidebar (항상 표시)
  ├─ mainView === "chat"     → ChatWindow
  ├─ mainView === "network"  → NetworkPanel
  ├─ mainView === "vault"    → VaultPanel
  ├─ mainView === "team"     → TeamPanel / TeamChatWindow (선택된 팀 여부)
  ├─ mainView === "cron"     → CronPanel
  ├─ mainView === "agent"    → AgentPanel
  ├─ mainView === "settings" → SettingsModal
  ├─ DebugPanel (토글)
  ├─ TourOverlay (가이드 투어)
  └─ WindowControls
```

---

## 7. 프론트엔드 초기화 흐름 (initService)

`src/services/initService.ts`의 `initializeApp()`:

```
Step 1:  loadSettings() — localStorage 캐시에서 동기 로드
Step 2:  fresh install 신호 스냅샷 (loadEnvDefaults 전)
Step 3:  loadEnvDefaults() — 백엔드에서 설정 하이드레이션 + 마이그레이션
Step 4:  기존 설치 판별 → seedManagerAgent + refreshDefaultManagerPersona
Step 5:  syncAgentsFromFs() — 파일시스템 ↔ DB 동기화
Step 6:  loadAgents() → loadConversations() → loadTeams() → loadCronJobs()
Step 7:  기존 사용자 자동 branding_initialized 설정
Step 8:  registerHeartbeatLifecycle() — 세션 시작/종료 이벤트 등록
Step 9:  initConsolidationRecovery() — 미완료 통합 복구 (비동기)
Step 10: appReady = true → 온보딩 게이트 판단 가능
```

### 온보딩 후 시딩

```typescript
seedManagerAfterOnboarding(locale)   // 기본 매니저 에이전트 생성
seedTemplateAgents(keys, locale)      // 선택한 템플릿 에이전트 시딩
```

---

## 8. 사이드바 구조 (Sidebar.tsx)

### 8.1 에이전트 목록

- 최근 대화 활동순으로 정렬 (agentLastActivity 맵 기반)
- 활동 없는 에이전트는 sort_order 순
- DM 대화 전용 (team_id 없는 대화만 집계)
- 클릭: `openAgentChat(agentId)` → 기존/새 대화 열기
- "+" 버튼: `handleNewAgent()` → 부트스트랩 시작

### 8.2 네비게이션 항목

| 항목 | 아이콘 | 뷰 | 조건 |
|------|--------|-----|------|
| 네트워크 | Network | network | 항상 표시 |
| Vault | BookOpen | vault | 항상 표시 |
| 팀 | Users | team | teams.length > 0일 때 표시 |
| 크론 | Clock | cron | cronJobs.length > 0일 때 표시 |
| 설정 | Settings | settings | 항상 표시 |

### 8.3 앱 타이틀

```javascript
t("appTitle", { companyName, context: uiTheme })
// org: "{companyName}" 또는 "Window Agent"
// classic: "Window Agent"
```

---

## 9. Tauri 커맨드 전체 목록 (도메인별)

### Conversation (12개)
`create_conversation`, `create_team_conversation`, `get_conversations`, `get_conversation_detail`, `get_messages`, `save_message`, `delete_conversation`, `update_conversation_title`, `update_conversation_summary`, `delete_messages_and_maybe_reset_summary`, `set_learning_mode`, `update_conversation_skills`

### Agent (12개)
`create_agent`, `get_agent`, `list_agents`, `update_agent`, `delete_agent`, `write_agent_file`, `read_agent_file`, `sync_agents_from_fs`, `seed_manager_agent`, `refresh_default_manager_persona`, `resize_avatar`, `get_bootstrap_prompt`

### API / LLM (11개)
`has_api_key`, `has_stored_key`, `get_no_proxy`, `set_no_proxy`, `set_api_config`, `check_api_health`, `chat_completion`, `chat_completion_stream`, `abort_stream`, `bootstrap_completion`, `list_models`

### Config (4개)
`get_app_settings`, `set_app_settings`, `migrate_frontend_settings`, `get_env_config`

### Tool (8개)
`execute_tool`, `create_tool_call_log`, `list_tool_call_logs`, `update_tool_call_log_status`, `get_native_tools`, `get_default_tool_config`, `read_tool_config`, `write_tool_config`

### Credential (4개)
`list_credentials`, `add_credential`, `update_credential`, `remove_credential`

### Skill (6개)
`list_skills`, `read_skill`, `read_skill_resource`, `create_skill`, `update_skill`, `delete_skill`

### Marketplace (3개)
`marketplace_fetch_plugins`, `marketplace_fetch_plugin_skills`, `marketplace_install_skills`

### Memory (12개)
`create_memory_note`, `list_memory_notes`, `update_memory_note`, `delete_memory_note`, `read_consolidated_memory`, `write_consolidated_memory`, `read_digest`, `write_digest`, `update_conversation_digest`, `update_conversation_consolidated`, `list_pending_consolidations`, `archive_conversation_notes`

### Vault (13개)
`vault_create_note`, `vault_read_note`, `vault_update_note`, `vault_delete_note`, `vault_list_notes`, `vault_search`, `vault_get_graph`, `vault_get_backlinks`, `vault_get_path`, `vault_open_in_obsidian`, `vault_rebuild_index`, `vault_archive_note`, `vault_list_notes_with_decay`

### Browser (10개)
`approve_browser_domain`, `get_browser_artifact`, `get_browser_headless`, `set_browser_headless`, `get_browser_proxy`, `set_browser_proxy`, `get_browser_no_proxy`, `set_browser_no_proxy`, `detect_system_proxy`, `detect_system_no_proxy`

### Relay / Network (29개)
`relay_start`, `relay_stop`, `relay_status`, `relay_generate_invite`, `relay_accept_invite`, `relay_list_contacts`, `relay_update_contact`, `relay_remove_contact`, `relay_approve_contact`, `relay_reject_contact`, `relay_bind_agent`, `relay_send_message`, `relay_list_threads`, `relay_get_thread`, `relay_get_thread_messages`, `relay_delete_thread`, `relay_clear_thread_messages`, `relay_get_peer_id`, `relay_get_network_enabled`, `relay_set_network_enabled`, `relay_get_connection_info`, `relay_get_relay_url`, `relay_set_relay_url`, `relay_get_allowed_tools`, `relay_set_allowed_tools`, `relay_search_directory`, `relay_send_friend_request`, `relay_update_directory_profile`, `relay_get_directory_settings`, `relay_set_directory_settings`

### Team (17개)
`create_team`, `get_team_detail`, `list_teams`, `update_team`, `delete_team`, `add_team_member`, `remove_team_member`, `create_team_run`, `update_team_run_status`, `get_team_run`, `get_running_runs`, `create_team_task`, `update_team_task`, `get_team_tasks`, `abort_team_run`, `execute_delegation`, `handle_team_report`

### Cron (8개)
`create_cron_job`, `list_cron_jobs`, `list_cron_jobs_for_agent`, `get_cron_job`, `update_cron_job`, `delete_cron_job`, `toggle_cron_job`, `list_cron_runs`

### Export/Import (2개)
`export_agent`, `import_agent`

### Misc (4개)
`read_file_base64`, `save_chat_image`, `get_shell_info`, `get_workspace_path`

**총계: ~155개**

---

## 소스 파일 참조

| 파일/디렉토리 | 역할 |
|--------------|------|
| `src/stores/` | Zustand 스토어 전체 (24개 파일) |
| `src/components/` | React 컴포넌트 (14개 디렉토리) |
| `src/services/` | 비즈니스 로직 서비스 |
| `src/services/commands/` | Tauri invoke 래퍼 (14개 파일) |
| `src/hooks/` | Custom React Hooks (8개) |
| `src/i18n/` | i18n 설정 + 로케일 리소스 |
| `src/i18n/locales/ko/` | 한국어 번역 (11개 namespace) |
| `src/i18n/locales/en/` | 영어 번역 (11개 namespace) |
| `src/data/agentTemplates.ts` | 에이전트 템플릿 데이터 |
