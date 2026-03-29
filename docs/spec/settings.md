# Settings, Theme & Onboarding Specification

> Window Agent의 설정 관리 시스템. 3개 store 파일로 분산 저장하며, 통합 `AppSettings` 구조체로 일원화된 읽기/쓰기 인터페이스를 제공한다.

---

## 1. AppSettings 전체 필드

`src-tauri/src/settings.rs`에 정의된 `AppSettingsInner` 구조체.

| 분류 | 필드 | 타입 | 기본값 | 저장소 |
|------|------|------|--------|--------|
| LLM | `model_name` | String | `"anthropic/claude-sonnet-4-20250514"` | app-settings.json |
| LLM | `thinking_enabled` | bool | `false` | app-settings.json |
| LLM | `thinking_budget` | u32 | `4096` | app-settings.json |
| UI | `ui_theme` | String | `"org"` | app-settings.json |
| UI | `company_name` | String | `""` | app-settings.json |
| UI | `branding_initialized` | bool | `false` | app-settings.json |
| UI | `locale` | String | `"ko"` | app-settings.json |
| Relay | `network_enabled` | bool | `false` | relay-settings.json |
| Relay | `relay_url` | String | `"wss://relay.windowagent.io/ws"` | relay-settings.json |
| Relay | `allowed_tools` | Vec\<String\> | `[]` | relay-settings.json |
| Relay | `discoverable` | bool | `true` | relay-settings.json |
| Relay | `directory_agent_name` | String | `""` | relay-settings.json |
| Relay | `directory_agent_description` | String | `""` | relay-settings.json |
| Browser | `browser_headless` | bool | `false` | browser-config.json |
| Browser | `browser_proxy` | String | `""` | browser-config.json |
| Browser | `browser_no_proxy` | String | `""` | browser-config.json |

### 별도 관리되는 설정 (AppSettings 외부)

| 설정 | 관리 구조체 | 저장소 | 이유 |
|------|------------|--------|------|
| API key / base_url / no_proxy | `ApiState` | `api-config.json` | 시크릿 격리 |
| Ed25519 키쌍 | `NodeIdentity` | `relay-identity.json` | 불변 ID |

---

## 2. Store 파일 매핑

3개의 `tauri-plugin-store` 파일에 분산 저장된다. 각 파일은 JSON 형식이며 `{app_data_dir}/` 아래에 위치한다.

### 2.1 app-settings.json

| 키 | 필드 | 비고 |
|-----|------|------|
| `model_name` | model_name | 빈 문자열이면 기본값 사용 |
| `thinking_enabled` | thinking_enabled | |
| `thinking_budget` | thinking_budget | |
| `ui_theme` | ui_theme | `"org"` 또는 `"classic"` |
| `company_name` | company_name | |
| `branding_initialized` | branding_initialized | |
| `locale` | locale | `"ko"` 또는 `"en"` |
| `_migrated` | (내부) | localStorage 마이그레이션 완료 플래그 |

### 2.2 relay-settings.json

| 키 | 필드 |
|-----|------|
| `network_enabled` | network_enabled |
| `relay_url` | relay_url |
| `allowed_tools` | allowed_tools |
| `discoverable` | discoverable |
| `directory_agent_name` | directory_agent_name |
| `directory_agent_description` | directory_agent_description |

### 2.3 browser-config.json

| 키 | 필드 | 비고 |
|-----|------|------|
| `headless` | browser_headless | store 키명이 필드명과 다름 |
| `proxy_server` | browser_proxy | store 키명이 필드명과 다름 |
| `no_proxy` | browser_no_proxy | store 키명이 필드명과 다름 |

---

## 3. 읽기/쓰기 모델

### 3.1 AppSettings 구조체

```rust
pub struct AppSettings {
    inner: Mutex<AppSettingsInner>,  // 전체 설정 스냅샷
}
```

### 3.2 Persist-first 패턴

설정 변경 시 항상 **디스크 먼저** 쓴 후 메모리를 갱신한다. 메모리만 변경되고 디스크 저장이 실패하는 불일치를 방지.

```
AppSettings::set(patch, app)
  1. Mutex 잠금 (전체 read-modify-write 보호)
  2. 현재값 + patch 병합 → 새 AppSettingsInner
  3. 변경된 분류별 store 파일에 persist
     - has_app  → app-settings.json 저장
     - has_relay → relay-settings.json 저장
     - has_browser → browser-config.json 저장
  4. 메모리 갱신 (*guard = new)
  5. Mutex 해제
  6. settings:changed 이벤트 방출 (프론트엔드 동기화)
```

### 3.3 Partial Update (AppSettingsPatch)

```rust
pub struct AppSettingsPatch {
    pub model_name:        Option<String>,
    pub thinking_enabled:  Option<bool>,
    pub thinking_budget:   Option<u32>,
    pub ui_theme:          Option<String>,
    pub company_name:      Option<String>,
    // ... 모든 필드가 Option<T>
}
```

- `None` = "현재 값 유지"
- `Some(value)` = "이 값으로 변경"
- 프론트엔드에서 변경된 필드만 전송 가능

### 3.4 Atomic 보호

`Mutex<AppSettingsInner>`로 동시 읽기-수정-쓰기 경합 방지. set() 전체가 하나의 임계 구역.

### 3.5 로드 우선순위

```
AppSettings::load(app)
  → read_from_store(app):
    1. store 파일에서 읽기 (3개 파일)
    2. 환경변수 오버라이드 (OPENAI_MODEL → model_name)
    3. 기본값 폴백
```

우선순위: **환경변수 > store 파일 > 코드 기본값**

### 3.6 localStorage 마이그레이션

```rust
AppSettings::migrate_from_frontend(values, app)
```

- 1회성 마이그레이션: localStorage 값 → store 파일
- `_migrated` 플래그로 중복 실행 방지
- store에 이미 존재하는 키는 건너뜀
- 타입 변환 처리:
  - `"true"`/`"false"` 문자열 → bool
  - 숫자 문자열 → u32

---

## 4. UI 테마 시스템

### 4.1 테마 유형

| 테마 | 코드값 | 메타포 |
|------|--------|--------|
| **조직형 (Organization)** | `"org"` | 에이전트를 "직원"으로, 관리를 "인사관리"로 표현 |
| **클래식 (Classic)** | `"classic"` | 기존 AI 에이전트 용어 사용 |

### 4.2 주요 용어 차이

| 개념 | org (한국어/English) | classic (한국어/English) |
|------|---------------------|------------------------|
| 에이전트 | 직원 / Employee | 에이전트 / Agent |
| 기본 에이전트 | 팀장 / Team Lead | 매니저 / Manager |
| 새로 만들기 | 채용하기 / Hire | 새 에이전트 / New Agent |
| 삭제 | 해고하기 / Fire | 삭제 / Delete |
| 관리 메뉴 | 인사관리 / HR | 에이전트 편집 / Edit |
| 페르소나 탭 | 인적사항/성격/매니저정보/업무규칙/업무도구 | IDENTITY/SOUL/USER/AGENTS/TOOLS |

### 4.3 적용 방식: i18n Context Suffix

i18next의 `context` 기능을 사용하여 테마별 번역을 선택한다.

```javascript
// 사용 측
t("glossary:agent", { context: uiTheme })
// glossary.json에서:
// "agent_org": "직원"
// "agent_classic": "에이전트"
```

### 4.4 Theme Variables (`themeVars.ts`)

`syncThemeVars(i18n, theme)` 함수가 glossary의 `term_*` 키에서 테마별 값을 추출하여 i18n의 `defaultVariables`에 주입한다.

```typescript
const TERM_KEYS = ["agent", "agents"] as const;
// → term_agent, term_agent_cap, term_agents, term_agents_cap 변수 생성
```

- 모든 namespace에서 `{{term_agent}}`, `{{term_agents}}` 등으로 참조 가능
- `_cap` 변수: 첫 글자 대문자 (영어 문장 시작용)
- 테마 또는 언어 변경 시 `syncThemeVars` 재호출

---

## 5. Onboarding 시스템

### 5.1 진입 조건

```
appReady === true && brandingInitialized === false
  → OnboardingScreen 표시
```

- `branding_initialized`가 `false`이면 fresh install로 간주
- 기존 설치 업그레이드 시 `initService`에서 자동으로 `true` 설정 (대화/설정 존재 확인)

### 5.2 4단계 흐름

```
┌─────────┐    ┌─────────┐    ┌───────────┐    ┌─────────┐
│ Language │ ── │  Setup  │ ── │ Templates │ ── │   API   │
│ (Step 1) │    │ (Step 2) │    │ (Step 3)  │    │ (Step 4) │
└─────────┘    └─────────┘    └───────────┘    └─────────┘
```

#### Step 1: Language

- 로케일 선택: `ko` (한국어) / `en` (영어)
- `setLocale(locale)` 호출 → i18n 언어 즉시 전환
- 다음 단계로 전환 시 선택한 로케일이 유지됨

#### Step 2: Setup

- 회사 이름 입력 (`companyName`)
- UI 테마 선택 (`org` / `classic`)
- "다음" 클릭 시:
  1. `seedManagerAfterOnboarding(locale)` → 기본 에이전트(매니저) 생성
  2. `syncAgentsFromFs()` → 파일시스템 동기화
  3. `loadAgents()` → 스토어 갱신

#### Step 3: Templates

- 에이전트 템플릿 선택 (복수 선택 가능, 선택하지 않아도 됨)
- `seedTemplateAgents(selectedKeys, locale)` 호출
- 선택한 템플릿마다:
  1. `createAgent()` → DB 행 생성
  2. 4개 persona 파일 작성 (IDENTITY.md, SOUL.md, USER.md, AGENTS.md)
  3. 기본 TOOL_CONFIG.json 작성
- 실패 시 cleanup (DB 행 삭제로 half-created 방지)
- 기존 folder_name과 중복되는 템플릿은 건너뜀 (idempotent)

#### Step 4: API

- LLM API 키 입력
- Base URL 입력 (선택)
- `saveOnboardingApiConfig(apiKey, baseUrl)` 호출
- 완료 시:
  1. `initializeBranding(companyName, theme, locale)` → `branding_initialized = true` 설정
  2. `setTourPending()` → 가이드 투어 예약

### 5.3 branding_initialized 플래그

| 상태 | 의미 | 동작 |
|------|------|------|
| `false` | fresh install (온보딩 미완료) | OnboardingScreen 표시 |
| `true` | 온보딩 완료 또는 기존 설치 | 정상 앱 진입 |

**기존 설치 자동 감지 (`initService.ts` Step 7):**
```
brandingInitialized === false
  && (conversations.length > 0 || localStorage에 설정 키 존재)
  → initializeBranding(companyName, theme) → true 설정
```

---

## 6. 에이전트 템플릿 시스템

### 6.1 AGENT_TEMPLATES

`src/data/agentTemplates.ts`에 정의된 사전 구성 에이전트 목록.

```typescript
interface AgentTemplate {
  key: string;                              // 고유 식별자
  folderName: string;                       // 디스크 폴더명
  displayName: Record<Locale, string>;      // 표시 이름 (ko/en)
  description: Record<Locale, string>;      // 설명 (ko/en)
  icon: string;                             // lucide 아이콘명
  personaFiles: Record<Locale, {            // 로케일별 persona 파일 내용
    identity: string;
    soul: string;
    user: string;
    agents: string;
  }>;
}
```

### 6.2 기본 템플릿 (4개)

| key | 한국어 이름 | 영어 이름 | 설명 |
|-----|-----------|----------|------|
| `code-reviewer` | 코드 리뷰어 | Code Reviewer | 코드 품질/보안 검토 |
| `doc-writer` | 문서 작성자 | Document Writer | 기술 문서/가이드 작성 |
| `data-analyst` | 데이터 분석가 | Data Analyst | 데이터 분석/인사이트 도출 |
| `general-assistant` | 범용 어시스턴트 | General Assistant | 다목적 도우미 |

---

## 7. 프론트엔드 설정 스토어 (`settingsStore.ts`)

### 7.1 SettingsState

```typescript
interface SettingsState {
  hasApiKey: boolean;         // API 접근 가능 여부
  hasStoredKey: boolean;      // 실제 API 키 저장 여부
  baseUrl: string;
  modelName: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  envLoaded: boolean;
  settingsError: string | null;
  uiTheme: UITheme;          // "org" | "classic"
  companyName: string;
  brandingInitialized: boolean;
  locale: Locale;             // "ko" | "en"
  appReady: boolean;          // 초기화 완료 여부
}
```

### 7.2 localStorage 동기화 캐시

프론트엔드는 localStorage를 **동기화 캐시**로 사용한다. 백엔드(store 파일)가 source of truth.

| localStorage 키 | 용도 |
|-----------------|------|
| `openai_base_url` | API base URL 캐시 |
| `openai_model_name` | 모델명 캐시 |
| `thinking_enabled` | thinking 모드 캐시 |
| `thinking_budget` | thinking 예산 캐시 |
| `ui_theme` | 테마 캐시 |
| `company_name` | 회사명 캐시 |
| `branding_initialized` | 온보딩 완료 캐시 |
| `locale` | 로케일 캐시 |

### 7.3 초기화 흐름 (loadEnvDefaults)

```
1. getAppSettings() → 백엔드에서 전체 설정 로드
2. migrateFrontendSettings(lsValues) → localStorage → store 1회 마이그레이션
3. 백엔드 설정으로 스토어 + localStorage 동시 갱신
4. settings:changed 이벤트 리스너 등록 (백엔드 변경 실시간 반영)
```

---

## 8. Tauri 커맨드

### 8.1 Settings 커맨드

| 커맨드 | 설명 |
|--------|------|
| `get_app_settings` | 현재 전체 설정 스냅샷 반환 |
| `set_app_settings` | AppSettingsPatch로 부분 업데이트 |
| `migrate_frontend_settings` | localStorage → store 1회 마이그레이션 |
| `get_env_config` | 환경변수 기반 설정 (base_url, model, no_proxy 등) |

### 8.2 API/LLM 커맨드 (설정 관련)

| 커맨드 | 설명 |
|--------|------|
| `has_api_key` | API 접근 가능 여부 (키 또는 커스텀 URL) |
| `has_stored_key` | 실제 API 키 문자열 존재 여부 |
| `set_api_config` | API 키 + base URL 저장 |
| `check_api_health` | API 연결 테스트 |
| `get_no_proxy` | API NO_PROXY 설정 조회 |
| `set_no_proxy` | API NO_PROXY 설정 변경 |

### 8.3 Browser 설정 커맨드

| 커맨드 | 설명 |
|--------|------|
| `get_browser_headless` | headless 모드 조회 |
| `set_browser_headless` | headless 모드 변경 |
| `get_browser_proxy` | 프록시 URL 조회 |
| `set_browser_proxy` | 프록시 URL 변경 |
| `get_browser_no_proxy` | NO_PROXY 목록 조회 |
| `set_browser_no_proxy` | NO_PROXY 목록 변경 |
| `detect_system_proxy` | 시스템 프록시 감지 |
| `detect_system_no_proxy` | 시스템 NO_PROXY 감지 |

### 8.4 Agent 커맨드 (온보딩 관련)

| 커맨드 | 설명 |
|--------|------|
| `seed_manager_agent` | 로케일 기반 기본 매니저 에이전트 생성 |
| `refresh_default_manager_persona` | 기본 매니저 persona 업그레이드 |
| `create_agent` | 에이전트 생성 (템플릿 시딩 시 사용) |
| `write_agent_file` | 에이전트 파일 작성 (persona 파일 시딩 시 사용) |
| `get_default_tool_config` | 기본 TOOL_CONFIG.json 반환 |

---

## 9. Tauri 이벤트

| 이벤트 | 페이로드 | 설명 |
|--------|---------|------|
| `settings:changed` | `AppSettingsInner` (전체 설정 JSON) | 백엔드에서 설정 변경 시 방출. 프론트엔드가 수신하여 스토어 동기화 |

---

## 10. 설정 UI 컴포넌트

```
components/settings/
├── SettingsModal.tsx           # 설정 모달 (메인 컨테이너)
├── GeneralSettingsPanel.tsx    # 일반 설정 (테마, 회사명, 로케일)
├── ApiServerSection.tsx        # API 서버 설정 (키, URL, 모델)
├── ThinkingSettingsPanel.tsx   # Thinking 모드 설정
├── BrandingSettingsPanel.tsx   # 브랜딩 설정
├── NetworkSettingsPanel.tsx    # 네트워크 설정 메인
├── NetworkToggleSection.tsx    # 릴레이 네트워크 토글
├── RelayConfigSection.tsx      # 릴레이 서버 URL 설정
├── RelayToolsSection.tsx       # 릴레이 허용 도구 설정
├── ProxySection.tsx            # 프록시/NO_PROXY 설정
├── CredentialManager.tsx       # 자격 증명 관리
└── ExportSection.tsx           # 에이전트 내보내기/가져오기
```

---

## 소스 파일 참조

| 파일 | 역할 |
|------|------|
| `src-tauri/src/settings.rs` | AppSettings, AppSettingsInner, AppSettingsPatch, store 읽기/쓰기/마이그레이션 |
| `src/stores/settingsStore.ts` | 프론트엔드 설정 Zustand 스토어 |
| `src/i18n/config.ts` | i18n 초기화, 로케일 설정, 한국어 조사 처리 |
| `src/i18n/themeVars.ts` | 테마 변수 동기화 (syncThemeVars) |
| `src/components/onboarding/OnboardingScreen.tsx` | 온보딩 4단계 UI |
| `src/data/agentTemplates.ts` | AGENT_TEMPLATES 정의 |
| `src/services/initService.ts` | 앱 초기화 + 온보딩 후 시딩 로직 |
