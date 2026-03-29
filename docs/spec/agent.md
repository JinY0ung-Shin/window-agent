# Agent System

에이전트 생성, 관리, 도구 사용, 시스템 프롬프트 구성을 포괄하는 통합 문서.

---

## 1. Agent 모델

### 1.1 DB 스키마 (agents 테이블)

| 필드 | 타입 | 설명 |
|------|------|------|
| id | TEXT PK | UUID |
| folder_name | TEXT UNIQUE | 디스크 폴더명 (`agents/{folder_name}/`) |
| name | TEXT | 표시명 |
| avatar | TEXT | base64 인코딩 이미지 |
| description | TEXT | 에이전트 설명 |
| model | TEXT | LLM 모델 오버라이드 (null이면 글로벌 설정 사용) |
| temperature | REAL | 온도 오버라이드 |
| thinking_enabled | INTEGER | Extended thinking 활성화 (nullable bool) |
| thinking_budget | INTEGER | Thinking 토큰 예산 |
| is_default | INTEGER | Manager agent 플래그 (1이면 기본 에이전트) |
| network_visible | INTEGER | 릴레이 네트워크 공개 여부 |
| sort_order | INTEGER | UI 정렬 순서 |
| created_at | TEXT | 생성 시각 |
| updated_at | TEXT | 수정 시각 |

### 1.2 CreateAgentRequest

```rust
pub struct CreateAgentRequest {
    pub folder_name: String,
    pub name: String,
    pub avatar: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget: Option<i64>,
    pub is_default: Option<bool>,
    pub network_visible: Option<bool>,
    pub sort_order: Option<i32>,
}
```

---

## 2. Persona 파일 구조

각 에이전트는 `{app_data_dir}/agents/{folder_name}/` 디렉토리에 다음 파일을 가진다:

| 파일 | 필수 | 설명 |
|------|------|------|
| **IDENTITY.md** | 권장 | 역할, 스타일, 응답 방식 정의 |
| **SOUL.md** | 권장 | 핵심 자아 인식 및 대화 철학 |
| **USER.md** | 선택 | 사용자 배경 및 맥락 |
| **AGENTS.md** | 선택 | 다른 팀원 소개 (팀 모드용) |
| **TOOL_CONFIG.json** | 자동 생성 | 도구 권한 설정 |

### Persona 조립 순서

```
[IDENTITY]
{IDENTITY.md 내용}

---

[SOUL]
{SOUL.md 내용}

---

[USER]
{USER.md 내용}

---

[AGENTS]
{AGENTS.md 내용}
```

비어있거나 없는 파일은 건너뛴다. 섹션 사이에 `\n\n---\n\n` 구분자를 삽입한다.

### 템플릿 변수

- `{{company_name}}`: AppSettings의 `company_name` 값으로 치환됨

---

## 3. TOOL_CONFIG.json 상세

### 3.1 구조 (v2)

```json
{
  "version": 2,
  "auto_approve": false,
  "native": {
    "read_file": { "enabled": true, "tier": "auto" },
    "write_file": { "enabled": true, "tier": "confirm" },
    "run_shell": { "enabled": true, "tier": "confirm" },
    "browser_navigate": { "enabled": true, "tier": "confirm" },
    "delegate": { "enabled": true, "tier": "auto" },
    "report": { "enabled": true, "tier": "auto" }
  },
  "credentials": {
    "github-token": { "allowed": true },
    "slack-webhook": { "allowed": false }
  }
}
```

### 3.2 필드 설명

| 필드 | 설명 |
|------|------|
| `version` | 설정 포맷 버전 (현재 2) |
| `auto_approve` | `true`이면 confirm-tier 도구도 자동 승인 (credential 관련 제외) |
| `native` | 도구별 `{ enabled, tier }` 맵. tier는 `auto` 또는 `confirm` |
| `credentials` | 에이전트가 접근 가능한 credential ID 맵. `{ allowed: bool }` 또는 레거시 `bool` |

### 3.3 Backend 읽기

`read_tool_config(agent_dir)` 함수가 TOOL_CONFIG.json을 파싱하여 `(tool_name, tier)` 쌍 목록을 반환한다.
- `delegate`, `report`는 별도 관리되므로 항상 제외
- 파일 누락이나 파싱 실패 시 빈 목록 반환 (에러 없음)

---

## 4. Credential 시스템

### 4.1 저장소 아키텍처

| 구분 | 파일 | 저장 방식 | 내용 |
|------|------|-----------|------|
| 비밀값 | `credentials-secrets.json` | tauri-plugin-store | credential ID -> 암호화된 실제 값 |
| 메타데이터 | `credentials_meta.json` | 일반 JSON 파일 | `[{ id, name, allowed_hosts, created_at, updated_at }]` |
| 접근 제어 | `TOOL_CONFIG.json` (에이전트별) | 일반 JSON 파일 | `credentials` 섹션에 에이전트별 허용 ID 목록 |

### 4.2 CredentialMeta 구조

```rust
pub struct CredentialMeta {
    pub id: String,           // [A-Za-z0-9_-]+ 패턴만 허용
    pub name: String,         // 사용자 표시명
    pub allowed_hosts: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}
```

### 4.3 CRUD 커맨드

- `list_credentials` -- 전체 메타데이터 목록
- `add_credential(id, name, value, allowed_hosts)` -- 비밀값 저장 + 메타데이터 생성
- `update_credential(id, name?, value?, allowed_hosts?)` -- 부분 업데이트
- `remove_credential(id)` -- 비밀값 + 메타데이터 삭제

### 4.4 도구에서의 사용

**run_shell:**
- `CRED_*` 환경변수 자동 주입 (예: `github-token` -> `$CRED_GITHUB_TOKEN`)
- `{{credential:KEY}}` 인라인 치환 (command 문자열에서 직접 치환)
- 변환 규칙: uppercase + 하이픈/공백 -> 언더스코어 + 특수문자 제거 + `CRED_` 접두사

**browser_type:**
- `{{credential:ID}}` placeholder 문법으로 비밀번호 자동 입력
- placeholder가 있으면 항상 confirm 유지 (auto_approve 무시)

**결과 보호:**
- 실행 결과에서 credential 값 자동 redact
- 다중 인코딩 감지: exact, URL-encoded, Base64, JSON-escaped
- LLM 전송 전 `scrub_messages()`로 모든 메시지의 credential 값 제거
- 포맷: `[CREDENTIAL:{id} REDACTED]`

---

## 5. Skill 시스템

### 5.1 구조

```
{app_data_dir}/agents/{folder_name}/skills/{skill_name}/
  skill.md          -- Markdown 기반 도구 확장 정의
  resources/        -- 스킬 리소스 파일 (선택)
```

### 5.2 커맨드

- `list_skills(agent_folder_name)` -- 에이전트의 스킬 목록
- `read_skill(agent_folder_name, skill_name)` -- skill.md 내용 읽기
- `read_skill_resource(agent_folder_name, skill_name, resource_path)` -- 리소스 파일 읽기
- `create_skill(agent_folder_name, skill_name, content)` -- 새 스킬 생성
- `update_skill(agent_folder_name, skill_name, content)` -- 스킬 업데이트
- `delete_skill(agent_folder_name, skill_name)` -- 스킬 삭제

### 5.3 Marketplace

- `marketplace_fetch_plugins()` -- 마켓플레이스에서 플러그인 목록 가져오기
- `marketplace_fetch_plugin_skills(plugin_id)` -- 플러그인의 스킬 목록
- `marketplace_install_skills(agent_folder_name, plugin_id, skill_names)` -- 스킬 설치

### 5.4 활성 스킬

대화별로 `conversations.active_skills` (JSON string array)에 활성화된 스킬 이름을 저장.
`update_conversation_skills(conversation_id, skills)` 커맨드로 토글.

---

## 6. Default (Manager) Agent

### 6.1 생성

`seed_manager_agent(locale)`:
- 로케일 기반 기본 에이전트 생성 (`is_default=true`)
- 번들 리소스 `resources/{locale}/default-agent/`에서 persona 파일 복사
- DB에 에이전트가 이미 존재하면 건너뜀 (idempotent)

### 6.2 업그레이드

`refresh_default_manager_persona(locale)`:
- 각 persona 파일(IDENTITY.md, SOUL.md, USER.md, AGENTS.md)을 번들 리소스와 비교
- 사용자가 수정하지 않은 파일만 최신 버전으로 교체
- 로케일 전환 시에도 동작 (이전 로케일의 기본값과 일치하면 새 로케일로 교체)

---

## 7. FS Sync

`sync_agents_from_fs()`:
- 디스크 `agents/` 폴더와 DB를 양방향 동기화
- **디스크에 있으나 DB에 없는 폴더** -> DB에 새 에이전트 레코드 추가
- **DB에 있으나 디스크에 없는 폴더** -> 경고만 (대화 히스토리 보존을 위해 삭제하지 않음)

---

## 8. Export / Import

- `export_agent(agent_id)` -> tar.gz 파일 (persona 파일 + TOOL_CONFIG.json + skills)
- `import_agent(file_path)` -> tar.gz 압축 해제 후 새 에이전트 생성 (DB + 디스크)

---

## 9. Native Tools (17개)

에이전트가 LLM tool_calls로 사용할 수 있는 내장 도구 목록.

### 9.1 전체 목록

| 도구 | 설명 | Default Tier | Timeout |
|------|------|-------------|---------|
| **read_file** | 파일 읽기 (scope: workspace/persona/vault) | auto | 30s |
| **write_file** | 파일 쓰기 | confirm | 30s |
| **delete_file** | 파일 삭제 | confirm | 30s |
| **list_directory** | 디렉토리 목록 (recursive 옵션) | auto | 30s |
| **web_search** | 웹 페이지 가져오기 (url 또는 query) | confirm | 30s |
| **browser_navigate** | URL로 이동 -> 페이지 스냅샷 반환 | confirm | 360s |
| **browser_snapshot** | 현재 페이지 스냅샷 | auto | 360s |
| **browser_click** | 요소 클릭 (ref 번호) | confirm | 360s |
| **browser_type** | 텍스트 입력 (`{{credential:ID}}` 문법 지원) | confirm | 360s |
| **browser_wait** | 대기 후 스냅샷 (max 10s) | auto | 360s |
| **browser_back** | 뒤로 가기 | confirm | 360s |
| **browser_close** | 브라우저 세션 종료 | confirm | 360s |
| **run_shell** | 셸 명령 실행 (SSH 자동 강화/차단) | confirm | 310s |
| **self_inspect** | 에이전트 상태/설정/도구/스케줄 조회 | auto | 30s |
| **manage_schedule** | Cron 작업 CRUD (list/create/update/delete/toggle) | confirm | 30s |
| **delegate** | 팀 멤버에게 작업 위임 (기본 비활성) | auto | 30s |
| **report** | 팀 리더에게 결과 보고 (기본 비활성) | auto | 30s |

### 9.2 Permission Tier

| Tier | 동작 |
|------|------|
| `auto` | 사용자 확인 없이 자동 실행 |
| `confirm` | 실행 전 사용자 승인 필요 (프론트엔드 approval UI 표시) |
| `deny` | 실행 거부 (도구가 등록되지 않은 경우) |

### 9.3 File Scope

| Scope | 경로 | 용도 |
|-------|------|------|
| `workspace` | `vault/{agent_id}/workspace/` | 대화별 작업 파일 |
| `persona` | `agents/{folder_name}/` | 에이전트 정체성 파일 (화이트리스트 제한) |
| `vault` | `vault/{agent_id}/{category}/` | 장기 메모리 (knowledge/decision/conversation/reflection) |

### 9.4 Credential in Tools

- **browser_type**: `{{credential:KEY}}` 문법으로 비밀번호 자동 입력. placeholder 사용 시 항상 confirm 유지.
- **run_shell**: 2가지 방식 병행
  - `CRED_*` 환경변수 자동 주입 (예: `$CRED_GITHUB_TOKEN`)
  - `{{credential:KEY}}` 인라인 치환 (command 문자열에서 직접 치환)
- 실행 결과에서 credential 값 자동 redact (환경변수/인라인 모두)
- **auto_approve 정책**:
  - `auto_approve=true`일 때 `run_shell`도 자동 승인 (credential 유무 무관, 환경변수 주입은 투명)
  - `browser_type`은 `{{credential:*}}` placeholder 사용 시에만 confirm 유지
  - `manage_schedule`은 항상 confirm (NEVER_AUTO_APPROVE_TOOLS)

---

## 10. System Prompt 구성 순서

`build_system_prompt(resolved, scope)` 함수가 다음 순서로 시스템 프롬프트를 조립한다:

### 10.1 구성 단계 (9단계)

```
1. [기본 시스템 프롬프트]
   persona 파일 조합: [IDENTITY] + [SOUL] + [USER] + [AGENTS]
   {{company_name}} 템플릿 변수 치환

2. [REGISTERED AGENTS]
   manager agent(is_default=true)만 해당
   다른 에이전트 목록: "- {name}: {description}" 형식

3. [VAULT -- Long-term Memory System]
   조건: write_file 활성 AND (consolidated_memory 존재 OR learning_mode)
   Obsidian 호환 마크다운 가이드, 카테고리, 위키링크, confidence/freshness 설명

4. [LEARNING MODE -- Activated]
   조건: learning_mode=true
   행동 규칙: Confirm, Connect, Ask, 최대 3개 메모리/턴, 기존 메모리 참조

5. [CONSOLIDATED MEMORY]
   조건: 메모리 존재 시
   에이전트의 누적 장기 메모리 내용

6. [SYSTEM CONTEXT]
   Available tools: {도구 이름 목록}

7. [AVAILABLE CREDENTIALS]
   조건: run_shell 또는 browser_type 활성 AND credentials 존재
   credential ID별 사용 방법 (환경변수 이름, browser placeholder)
   "Never echo, print, or expose credential values directly."

8. [역할 지시]
   role별 행동 지침 (아래 참조)

9. [PEER CONTEXT] (RelayResponse only)
   상대방 정보: display_name, agent_name, agent_description
```

### 10.2 역할별 지시

| Role | 지시 내용 |
|------|----------|
| `Dm` | 없음 (기본: "Complete the task below.") |
| `TeamLeader` | 없음 (기본) |
| `TeamMember` | "`report` 도구로 결과를 보고하라" |
| `TeamLeaderSynthesis` | "팀 멤버 보고서를 종합하라" |
| `CronExecution` | "스케줄된 작업을 완수하고 결과를 요약하라" |
| `RelayResponse` | "외부 피어의 메시지에 자연스럽게 응답하라. 필요하면 도구를 사용하라" |

### 10.3 PEER CONTEXT (RelayResponse 전용)

Secretary 자동응답 시 추가되는 피어 컨텍스트:

```
[PEER CONTEXT]
You are conversing with an external peer (from another organization/user).
- Peer display name: {display_name}
- Peer agent: {agent_name} ({agent_description})
```

---

## 11. ExecutionScope / ExecutionRole / resolve_with_settings

### 11.1 ExecutionScope

모든 LLM 호출의 실행 컨텍스트를 정의한다.

```rust
pub struct ExecutionScope {
    pub actor_agent_id: String,
    pub role: ExecutionRole,
    pub trigger: ExecutionTrigger,
}
```

### 11.2 ExecutionRole

```rust
pub enum ExecutionRole {
    Dm,                    // 단일 에이전트 (프론트엔드 direct message)
    TeamLeader,            // 팀 리더 (사용자 시작)
    TeamMember,            // 위임된 작업 실행
    TeamLeaderSynthesis,   // 멤버 보고서 종합
    CronExecution,         // 예약 작업 실행
    RelayResponse,         // 외부 피어 메시지 자동 응답
}
```

### 11.3 ExecutionTrigger

```rust
pub enum ExecutionTrigger {
    UserInitiated,      // 사용자 메시지로 시작
    BackendTriggered,   // 백엔드 오케스트레이션 (팀 위임 등)
}
```

### 11.4 resolve_with_settings 흐름

`ExecutionScope` -> `ResolvedContext` 변환 과정:

```
1. Agent 로드 (DB에서 agent_id로 조회)
2. Persona 파일 조합 (agent_dir에서 IDENTITY + SOUL + USER + AGENTS 읽기)
   - {{company_name}} 치환
3. TOOL_CONFIG.json에서 role/trigger별 도구 필터링
4. LLM 설정 resolve: agent 오버라이드 > global_model > DEFAULT_MODEL
5. SystemMemoryManager에서 consolidated memory 읽기
6. Manager agent인 경우 [REGISTERED AGENTS] 섹션 빌드
7. [SYSTEM CONTEXT] 섹션 빌드 (활성 도구 목록)
8. credentials_section 빌드 (run_shell/browser_type 활성 + credential 존재 시)
9. learning_mode 조회 (conversation_id가 주어진 경우)
```

### 11.5 ResolvedContext

```rust
pub struct ResolvedContext {
    pub system_prompt: String,
    pub enabled_tool_names: Vec<String>,
    pub model: String,
    pub temperature: Option<f64>,
    pub thinking_enabled: bool,
    pub thinking_budget: Option<i64>,
    pub consolidated_memory: Option<String>,
    pub registered_agents_section: Option<String>,
    pub tools_section: Option<String>,
    pub credentials_section: Option<String>,
    pub learning_mode: bool,
}
```

### 11.6 Role별 도구 제한

| Role | 도구 정책 |
|------|----------|
| **Dm** | 빈 목록 반환 (프론트엔드가 도구를 제공) |
| **TeamLeader (UserInitiated)** | 모든 활성 도구 + `delegate` |
| **TeamLeader (BackendTriggered)** | auto-tier 도구만 + `delegate` |
| **TeamMember** | `report`만 |
| **TeamLeaderSynthesis** | 빈 목록 (읽기 전용 종합) |
| **CronExecution** | 활성 도구 중 browser_*/delegate/report/run_shell/manage_schedule 제외 |
| **RelayResponse** | 사용자 설정 allowed list로 필터 (기본: read_file, list_directory, web_search, self_inspect). run_shell 항상 차단 |
