# Window Agent — System Specification

> AI 에이전트 기반 데스크톱 어시스턴트. 여러 에이전트를 생성하고, 도구를 사용하며, 브라우저 자동화를 수행하고, 릴레이 네트워크를 통해 에이전트 간 통신을 지원한다.

**Version:** 0.14.2
**Last Updated:** 2026-03-29

---

## 1. Architecture Overview

```
window-agent/
├── src/                  # Frontend (React 19 + TypeScript + Vite)
├── src-tauri/            # Backend (Tauri 2 + Rust)
├── relay-server/         # Relay Server (Rust, axum + WebSocket)
├── shared/               # Client-Server 공유 프로토콜 (Rust crate)
└── browser-sidecar/      # Browser Automation (Node.js + Playwright)
```

### Tech Stack
- **Frontend:** React 19, TypeScript, Zustand (state), i18next (i18n), Vite
- **Backend:** Tauri 2, Rust, SQLite (rusqlite, WAL mode), tokio (async)
- **Relay Server:** axum, sqlx (async SQLite), tokio-tungstenite (WebSocket)
- **Shared:** serde JSON 프로토콜 (tagged enum)
- **Browser:** Playwright (Node.js sidecar process, HTTP API)
- **Crypto:** ed25519-dalek, x25519-dalek, chacha20poly1305, hkdf

### Managed State (Tauri setup)
앱 시작 시 다음 상태가 `app.manage()`로 등록된다:
- `Database` — SQLite 연결 (chat.db)
- `ApiState` — LLM API 키/URL + RunRegistry (스트림 중단용)
- `AppSettings` — 통합 설정 (3개 store 파일)
- `NodeIdentity` — Ed25519 키쌍 (relay-identity.json)
- `RelayManager` — 네트워크 상태 머신
- `SystemMemoryManager` — 에이전트 메모리 파일 관리
- `VaultState` — Mutex<VaultManager> (Markdown 노트 관리)
- `VaultWatcher` — 외부 편집 동기화 (300ms polling)
- `BrowserManager` — Playwright sidecar + 세션 관리
- `CronScheduler` — 백그라운드 cron 스케줄러
- `RunRegistry` — 활성 스트림/팀 실행 추적

### 앱 시작 순서
1. `.env` 로드 (dotenvy)
2. tracing 초기화
3. DB 열기 + 스키마 마이그레이션
4. ApiState, AppSettings 로드
5. Legacy store 마이그레이션 (p2p → relay)
6. VaultManager + VaultWatcher 초기화
7. NodeIdentity + RelayManager 초기화 (dormant)
8. SystemMemoryManager 초기화
9. 정체된 TeamRun 복구
10. CronScheduler 백그라운드 루프 시작
11. BrowserManager + idle cleanup 시작

---

## 2. Database Schema

단일 SQLite DB (`chat.db`), WAL 모드, `SCHEMA_VERSION = 1` + incremental migrations.

### 2.1 agents
```sql
CREATE TABLE agents (
    id               TEXT PRIMARY KEY,       -- UUID
    folder_name      TEXT NOT NULL UNIQUE,   -- 디스크 폴더명
    name             TEXT NOT NULL,
    avatar           TEXT,                   -- base64 이미지
    description      TEXT NOT NULL DEFAULT '',
    model            TEXT,                   -- LLM 모델 오버라이드
    temperature      REAL,
    thinking_enabled INTEGER,                -- nullable bool
    thinking_budget  INTEGER,
    is_default       INTEGER DEFAULT 0,      -- manager agent 플래그
    network_visible  INTEGER DEFAULT 0,      -- 네트워크에 공개 여부
    sort_order       INTEGER DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
```

### 2.2 conversations
```sql
CREATE TABLE conversations (
    id                        TEXT PRIMARY KEY,
    title                     TEXT NOT NULL,
    agent_id                  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    team_id                   TEXT REFERENCES teams(id) ON DELETE SET NULL,
    summary                   TEXT,
    summary_up_to_message_id  TEXT,
    active_skills             TEXT,           -- JSON string array
    learning_mode             INTEGER DEFAULT 0,
    digest_id                 TEXT,
    consolidated_at           TEXT,
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL
);
```

### 2.3 messages
```sql
CREATE TABLE messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL,           -- user | assistant | system | tool
    content          TEXT NOT NULL,
    tool_call_id     TEXT,
    tool_name        TEXT,
    tool_input       TEXT,
    sender_agent_id  TEXT,                   -- 팀 모드 발신자
    team_run_id      TEXT,
    team_task_id     TEXT,
    attachments      TEXT,                   -- JSON
    created_at       TEXT NOT NULL
);
```

### 2.4 tool_call_logs
```sql
CREATE TABLE tool_call_logs (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id       TEXT,
    tool_name        TEXT NOT NULL,
    tool_input       TEXT NOT NULL,
    tool_output      TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',  -- pending | executed | error
    duration_ms      INTEGER,
    artifact_id      TEXT,
    agent_id         TEXT,
    created_at       TEXT NOT NULL
);
```

### 2.5 browser_artifacts
```sql
CREATE TABLE browser_artifacts (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    snapshot_full    TEXT NOT NULL,           -- DOM 스냅샷
    ref_map_json     TEXT NOT NULL,           -- element ref 매핑
    url              TEXT NOT NULL,
    title            TEXT NOT NULL,
    screenshot_path  TEXT,
    created_at       TEXT NOT NULL
);
```

### 2.6 contacts
```sql
CREATE TABLE contacts (
    id                    TEXT PRIMARY KEY,
    peer_id               TEXT NOT NULL UNIQUE,
    public_key            TEXT NOT NULL,
    display_name          TEXT NOT NULL,
    agent_name            TEXT NOT NULL DEFAULT '',
    agent_description     TEXT NOT NULL DEFAULT '',
    local_agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
    mode                  TEXT NOT NULL DEFAULT 'secretary',
    capabilities_json     TEXT NOT NULL DEFAULT '{"can_send_messages":true,"can_read_agent_info":true,...}',
    status                TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | pending_approval | pending_outgoing | rejected
    invite_card_raw       TEXT,
    addresses_json        TEXT,
    published_agents_json TEXT,              -- 상대방의 공개 에이전트 목록 JSON
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);
```

### 2.7 peer_threads
```sql
CREATE TABLE peer_threads (
    id              TEXT PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    local_agent_id  TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title           TEXT NOT NULL DEFAULT '',
    summary         TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
```

### 2.8 peer_messages
```sql
CREATE TABLE peer_messages (
    id                  TEXT PRIMARY KEY,
    thread_id           TEXT NOT NULL REFERENCES peer_threads(id) ON DELETE CASCADE,
    message_id_unique   TEXT NOT NULL UNIQUE,
    correlation_id      TEXT,
    direction           TEXT NOT NULL,        -- incoming | outgoing
    sender_agent        TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL,
    approval_state      TEXT NOT NULL DEFAULT 'none',
    delivery_state      TEXT NOT NULL DEFAULT 'pending',  -- pending | queued | sent | delivered
    retry_count         INTEGER NOT NULL DEFAULT 0,
    raw_envelope        TEXT,
    target_agent_id     TEXT,                -- 상대방이 선택한 대상 에이전트
    responding_agent_id TEXT,                -- 실제 응답한 에이전트
    created_at          TEXT NOT NULL
);
```

### 2.9 outbox
```sql
CREATE TABLE outbox (
    id              TEXT PRIMARY KEY,
    peer_message_id TEXT NOT NULL REFERENCES peer_messages(id) ON DELETE CASCADE,
    target_peer_id  TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_retry_at   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL
);
```

### 2.10 teams / team_members / team_runs / team_tasks
```sql
CREATE TABLE teams (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    leader_agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE team_members (
    id        TEXT PRIMARY KEY,
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member',  -- leader | member
    joined_at TEXT NOT NULL,
    UNIQUE(team_id, agent_id)
);

CREATE TABLE team_runs (
    id               TEXT PRIMARY KEY,
    team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    leader_agent_id  TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'running',  -- running | waiting_reports | synthesizing | completed | failed | cancelled
    started_at       TEXT NOT NULL,
    finished_at      TEXT
);

CREATE TABLE team_tasks (
    id                TEXT PRIMARY KEY,
    run_id            TEXT NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
    agent_id          TEXT NOT NULL,
    request_id        TEXT,                  -- RunRegistry request ID (스트림 중단용)
    task_description  TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed | cancelled
    parent_message_id TEXT,
    result_summary    TEXT,
    started_at        TEXT,
    finished_at       TEXT
);
```

### 2.11 cron_jobs / cron_runs
```sql
CREATE TABLE cron_jobs (
    id              TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    schedule_type   TEXT NOT NULL CHECK(schedule_type IN ('at','every','cron')),
    schedule_value  TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_run_at     TEXT,
    next_run_at     TEXT,
    last_result     TEXT CHECK(last_result IN ('success','failed')),
    last_error      TEXT,
    run_count       INTEGER NOT NULL DEFAULT 0,
    claimed_at      TEXT,                    -- 중복 실행 방지
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE cron_runs (
    id              TEXT PRIMARY KEY,
    job_id          TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    agent_id        TEXT NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('running','success','failed')),
    prompt          TEXT NOT NULL,
    result_summary  TEXT,
    error           TEXT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT
);
```

---

## 3. Agent System

### 3.1 Persona 파일 구조
각 에이전트는 `{app_data_dir}/agents/{folder_name}/` 디렉토리에 다음 파일을 가진다:
- **IDENTITY.md** — 역할, 스타일, 응답 방식 정의
- **SOUL.md** — 핵심 자아 인식 및 대화 철학
- **USER.md** — 사용자 배경 및 맥락
- **AGENTS.md** — 다른 팀원 소개 (팀 모드용)
- **TOOL_CONFIG.json** — 도구 권한 설정

### 3.2 TOOL_CONFIG.json
```json
{
  "native_tools": {
    "permission_tier": "standard",     // standard | advanced
    "allowed_tools": [],               // 화이트리스트 (비어있으면 tier 기본)
    "denied_tools": []                 // 블랙리스트
  }
}
```

### 3.3 Credential 시스템
- 에이전트별 `{agent_dir}/credentials.json`에 키-값 저장
- LLM 호출 전 credential 값 스크러빙 (민감 정보가 prompt에 노출되지 않도록)
- Tauri commands: `list_credentials`, `add_credential`, `update_credential`, `remove_credential`

### 3.4 Skill 시스템
- 디렉토리: `{agent_dir}/skills/{skill_name}/skill.md`
- Markdown 파일 기반 도구 확장
- Marketplace에서 플러그인 설치 가능 (`marketplace_fetch_plugins`, `marketplace_install_skills`)

### 3.5 Default (Manager) Agent
- `seed_manager_agent(locale)`: 로케일 기반 기본 에이전트 생성 (is_default=true)
- 번들 리소스 `resources/{locale}/default-agent/`에서 persona 파일 복사
- `refresh_default_manager_persona`: 사용자 수정 없으면 업그레이드

### 3.6 FS Sync
- `sync_agents_from_fs()`: 디스크 폴더 ↔ DB 양방향 동기화
- 디스크에 있으나 DB에 없는 폴더 → DB에 추가
- DB에 있으나 디스크에 없는 폴더 → 경고만 (히스토리 보존)

### 3.7 Export/Import
- `export_agent(agent_id)` → tar.gz 파일 (persona + config + skills)
- `import_agent(file_path)` → 새 에이전트 생성

---

## 4. Actor Context & LLM Pipeline

### 4.1 ExecutionScope
모든 LLM 호출은 `ExecutionScope`로 컨텍스트가 결정된다:
```rust
ExecutionScope {
    actor_agent_id: String,
    role: ExecutionRole,       // Dm | TeamLeader | TeamMember | TeamLeaderSynthesis | CronExecution | RelayResponse
    trigger: ExecutionTrigger, // UserInitiated | BackendTriggered
}
```

### 4.2 resolve_with_settings()
Scope → ResolvedContext 변환:
1. Agent 로드 (DB)
2. Persona 파일 조합 (IDENTITY + SOUL + USER + AGENTS)
3. TOOL_CONFIG.json에서 role별 도구 필터링
4. SystemMemoryManager에서 consolidated memory 읽기
5. credentials_section 빌드
6. 모델/temperature/thinking 설정 resolve (agent 오버라이드 > 글로벌)

### 4.3 Role별 도구 제한
| Role | 제한 사항 |
|------|----------|
| Dm | 제한 없음 |
| TeamLeader | `delegate` 사용 가능 |
| TeamMember | `delegate` 불가, `report` 필수 |
| TeamLeaderSynthesis | 합성 전용 |
| CronExecution | 제한적 도구 (run_shell, manage_schedule 차단 가능) |
| RelayResponse | relay_tools 또는 읽기 전용 |

### 4.4 LLM 호출 흐름
**프론트엔드 (스트리밍):**
```
chat_completion_stream(request) → Tauri event "completion-chunk" 스트리밍
```

**백엔드 (비스트리밍, tool loop):**
```
do_completion(client, api_key, base_url, body) → ChatCompletionResponse
  - thinking 에러 시 자동 폴백 (thinking 제거 후 재시도)
  - tool_calls 있으면 실행 후 재호출 (max 10 iterations)
```

### 4.5 Tool Execution
```
execute_tool(tool_name, tool_input, conversation_id)
  → tool_call_log 생성 (pending)
  → timeout 설정 (browser: 360s, shell: 310s, 기타: 30s)
  → dispatcher 라우팅 (shell_tools, file_tools, browser_tools, self_tools)
  → 결과 파싱 + artifact_id 추출
  → tool_call_log 업데이트
```

---

## 5. Team System

### 5.1 구조
- Team: leader_agent + member agents
- TeamRun: 한 번의 팀 작업 세션 (conversation에 바인딩)
- TeamTask: 각 멤버에게 위임된 작업

### 5.2 흐름
```
1. Leader가 delegate tool 사용 → execute_delegation()
2. 각 멤버별 task 생성 (queued) → 병렬 LLM 스트림 시작
3. TeamRun 상태 → waiting_reports
4. 멤버가 report tool 사용 → handle_team_report()
5. 모든 task 완료 → TeamRun 상태 → synthesizing
6. Leader synthesis LLM 호출 → 결과 통합
7. TeamRun 상태 → completed
```

### 5.3 복구
- 앱 시작 시 `TeamOrchestrator::recover_runs()` 호출
- 정체된 running task → failed로 전환

---

## 6. Cron System

### 6.1 Schedule Types
- `at`: ISO 3339 타임스탬프 (1회 실행)
- `every`: 초 단위 간격 (최소 60초)
- `cron`: cron 표현식 (5-field, `cron` crate)

### 6.2 스케줄러 루프
```
1. Startup: 정체된 claims 리셋 (30분+)
2. Startup: misfire coalesce (놓친 job 1회 실행)
3. Loop:
   a. due job claim (claimed_at 설정으로 중복 방지)
   b. 각 job tokio::spawn 실행 (CronExecution role)
   c. 완료 후: status, result_summary 저장 + next_run_at 재계산
   d. sleep (다음 due까지) or notify 대기
```

---

## 7. Memory System

### 7.1 Consolidated Memory (파일 기반)
```
{app_data_dir}/memory/{agent_id}/
  consolidated.md              -- 현재 누적 메모리
  snapshots/v{N}_{timestamp}.md -- 버전 스냅샷
  digests/{conversation_id}.md -- 대화별 요약
```

- `read_consolidated_memory(agent_id)` → 현재 메모리 문자열
- `write_consolidated_memory(agent_id, content, version)` → 스냅샷 저장 후 업데이트
- `write_digest(agent_id, conversation_id, content)` → 대화 요약 저장
- ResolvedContext에 포함되어 LLM system prompt에 주입

### 7.2 Memory Notes (DB 테이블)
- `create_memory_note`, `list_memory_notes`, `update_memory_note`, `delete_memory_note`
- 에이전트별 단순 노트 저장

---

## 8. Vault System (Knowledge Graph)

파일 기반 Markdown 노트 시스템 (Obsidian 호환).

### 8.1 디렉토리 구조
```
{app_data_dir}/vault/{agent_id}/
  notes/{note_id}.md           -- YAML frontmatter + Markdown content
  metadata/
    index.json                 -- 빠른 검색용 인덱스
```

### 8.2 VaultNote 구조
YAML frontmatter에 다음 메타데이터 저장:
- id, agent, note_type (concept/reference/user-feedback 등)
- tags, confidence (0.0~1.0), revision
- source, aliases, scope, source_conversation

### 8.3 주요 기능
- CRUD: `vault_create_note`, `vault_read_note`, `vault_update_note`, `vault_delete_note`
- 검색: `vault_search(query, agent_id)`, `vault_list_notes`
- 그래프: `vault_get_graph(agent_id)`, `vault_get_backlinks(note_id)`
- Obsidian 연동: `vault_open_in_obsidian(note_path)`
- Decay: `vault_list_notes_with_decay` (시간 경과에 따른 신뢰도 감소)
- VaultWatcher: 외부 편집 동기화 (300ms 간격 파일 변경 감지)

---

## 9. Network / Relay System

### 9.1 프로토콜 (shared/src/protocol.rs)

**ServerMessage (Server → Client):**
| Variant | 설명 |
|---------|------|
| Challenge | nonce + server_time (인증 시작) |
| AuthOk | peer_id (인증 성공) |
| Envelope | sender_peer_id + 암호화된 봉투 |
| ServerAck | message_id + status (Delivered/Queued) |
| PeerAck | message_id (피어 수신 확인) |
| Presence | peer_id + Online/Offline |
| PresenceSnapshot | 구독 피어 일괄 상태 |
| ProfileUpdated | discoverable 확인 |
| DirectoryResult | query, peers[], total, offset |
| PeerProfileResult | 단일 피어 프로필 |
| Error | code + message |

**ClientMessage (Client → Server):**
| Variant | 설명 |
|---------|------|
| Auth | peer_id + public_key(base64) + signature |
| Envelope | target_peer_id + 암호화된 봉투 |
| PeerAck | message_id + sender_peer_id |
| SubscribePresence | peer_ids[] |
| UpdateProfile | agent_name, description, discoverable, agents[] |
| SearchDirectory | query + limit + offset |
| GetPeerProfile | peer_id |

**PublishedAgent:**
```rust
pub struct PublishedAgent {
    pub agent_id: String,
    pub name: String,
    pub description: String,
}
```

### 9.2 Envelope (application layer)
```rust
Envelope {
    version: u32,              // PROTOCOL_VERSION = 1
    message_id: String,        // UUID
    correlation_id: Option<String>,
    timestamp: String,         // RFC3339
    sender_agent: String,
    payload: Payload,
}

Payload variants:
  Introduce { agent_name, agent_description, public_key, published_agents? }
  MessageRequest { content, target_agent_id? }
  MessageResponse { content, responding_agent_id? }
  Ack { acked_message_id }
  Error { code, message }
```

### 9.3 E2E 암호화
```
EncryptedEnvelope {
    header: EnvelopeHeader,          // 평문 (라우팅용, AAD로 사용)
    encrypted_payload: Vec<u8>,      // ChaCha20-Poly1305 암호문
    nonce: Vec<u8>,                  // 12 bytes
    sender_x25519_public: Vec<u8>,   // 32 bytes
}

암호화 흐름:
  Ed25519 secret → X25519 secret (SHA-512 clamping)
  DH shared secret = X25519(sender_secret, receiver_public)
  symmetric_key = HKDF-SHA256(shared_secret, info="wa-e2e-chacha20poly1305")
  encrypt: ChaCha20-Poly1305(key, random_nonce, plaintext, aad=header_json)
```

### 9.4 Identity
- Ed25519 키쌍 (relay-identity.json, tauri-plugin-store)
- `peer_id = hex(public_key[0..16])` (32자 hex 문자열)
- 인증: 서버가 Challenge(nonce) → 클라이언트가 sign(nonce) → 서버가 verify

### 9.5 ContactCard / Invite
```rust
ContactCard (v2) {
    version: 2,
    peer_id, public_key, addresses, relay_hints,
    relay_url?, expiry?, agent_name, agent_description,
    created_at, signature (Ed25519)
}
```
- `to_invite_code()`: JSON → Base64-URL-safe 인코딩
- `parse_invite()`: 디코드 → 서명 검증 → 만료 확인

### 9.6 Capability
```rust
CapabilitySet {
    can_send_messages: bool,      // Phase 1: true
    can_read_agent_info: bool,    // Phase 1: true
    can_request_tasks: bool,      // Phase 2 예정
    can_access_tools: bool,       // Phase 2 예정
    can_write_vault: bool,        // Phase 2 예정
}
```

### 9.7 RelayManager 상태 머신
```
Dormant ──start()──→ Starting ──connected──→ Active
   ↑                                           ↓ disconnect
   └───stop()───────── Stopping ←─── Reconnecting
                                      (지수 백오프 1s→60s)
```

### 9.8 Secretary 자동응답
수신 MessageRequest 처리:
1. target_agent_id로 스레드 라우팅 (agent별 스레드 분리)
2. `resolve_agent_id()` 우선순위:
   - target_agent_id (방문자 선택, network_visible 검증)
   - thread.local_agent_id
   - contact.local_agent_id
   - default agent
3. system prompt에 `[PEER CONTEXT]` 섹션 추가 (상대방 이름/에이전트 정보)
4. 해당 에이전트의 persona + tools로 LLM 호출 (tool loop, max 10 iterations)
5. MessageResponse에 responding_agent_id 포함하여 응답

### 9.8.1 프론트엔드 메시지 표시
- **기본 모드 ("내 대화")**: 내가 UI에서 보낸 메시지(`direction=outgoing`, `responding_agent_id=null`)와 그에 대한 상대방 응답(`direction=incoming`, `correlation_id`가 내 메시지에 연결)만 표시
- **전체 보기**: 상대방이 보낸 요청 + 내 에이전트의 자동응답까지 모두 표시
- PeerThread 헤더의 👁 토글로 전환, `showAllMessages` 상태로 관리

### 9.8.2 대화 기록 관리
- `relay_clear_thread_messages(thread_id)`: 스레드의 모든 메시지 일괄 삭제
- `relay_delete_thread(thread_id)`: 스레드 자체 삭제 (CASCADE로 메시지도 삭제)
- UI에서 🗑 버튼 (2단계 확인: 첫 클릭 → confirm → 3초 내 재클릭 → 실행)

### 9.9 에이전트 공개 (network_visible)
- AgentEditor에서 "네트워크에 공개" 토글
- `network_visible=true`인 에이전트 목록이 UpdateProfile, Introduce에 포함
- 상대방은 디렉토리 검색이나 Introduce에서 공개 에이전트 목록을 수신
- 채팅 시 상대방이 에이전트를 선택하여 대화 (PeerChatInput 드롭다운)

### 9.10 Relay Server
- **offline_queue**: 오프라인 피어용 메시지 큐 (per-peer 1000개 cap, 7일 TTL)
- **peer_directory**: 피어 프로필 + agents_json (discoverable 검색)
- **state**: connections, known_keys, presence_subscriptions, seen_messages(1hr dedup), search_rate_limits(10req/60s)

---

## 10. Browser Automation

### 10.1 구조
- `browser-sidecar/`: Node.js + Playwright (Chromium)
- Tauri에서 sidecar 프로세스로 실행 (동적 포트)
- HTTP API로 통신 (localhost)

### 10.2 BrowserManager
```rust
BrowserManager {
    sessions: HashMap<session_id, BrowserSession>,
    sidecar: Option<SidecarProcess>,
    pending_approvals: HashMap<conversation_id, HashSet<domain>>,
    headless: bool,
    proxy_server: String,
    no_proxy: String,       // 쉼표 구분 바이패스 도메인
}
```

### 10.3 BrowserSession
```rust
BrowserSession {
    session_id: String,
    last_url: String,
    last_title: String,
    last_ref_map: HashMap<u32, ElementRef>,  // element ref → selector 매핑
    last_active: DateTime,
    security_policy: SessionSecurityPolicy,
}
```

### 10.4 보안
- 도메인별 승인 필요 (`approve_browser_domain`)
- session별 security policy (blocked_origins, approved_domains)
- browser_artifacts에 스냅샷/스크린샷 저장

---

## 11. Settings System

### 11.1 AppSettings 필드
| 분류 | 필드 | 기본값 | 저장소 |
|------|------|--------|--------|
| LLM | model_name | "anthropic/claude-sonnet-4-20250514" | app-settings.json |
| LLM | thinking_enabled | false | app-settings.json |
| LLM | thinking_budget | 4096 | app-settings.json |
| UI | ui_theme | "org" | app-settings.json |
| UI | company_name | "" | app-settings.json |
| UI | branding_initialized | false | app-settings.json |
| UI | locale | "ko" | app-settings.json |
| Relay | network_enabled | false | relay-settings.json |
| Relay | relay_url | "wss://relay.windowagent.io/ws" | relay-settings.json |
| Relay | allowed_tools | [] | relay-settings.json |
| Relay | discoverable | true | relay-settings.json |
| Relay | directory_agent_name | "" | relay-settings.json |
| Relay | directory_agent_description | "" | relay-settings.json |
| Browser | browser_headless | false | browser-config.json |
| Browser | browser_proxy | "" | browser-config.json |
| Browser | browser_no_proxy | "" | browser-config.json |

### 11.2 읽기/쓰기 모델
- **Persist-first:** store 파일에 먼저 쓰기 → 메모리 갱신 → 이벤트 방출
- **Partial update:** `AppSettingsPatch` (모든 필드 `Option<T>`)
- **Atomic:** Mutex로 read-modify-write 보호
- **마이그레이션:** `migrate_from_frontend()` — localStorage → store (1회)

---

## 12. Frontend Structure

### 12.1 Zustand Stores
| Store | 역할 |
|-------|------|
| agentStore | 에이전트 CRUD, editor 상태 |
| bootstrapStore | 초기화 상태 |
| chatFlowStore / chatFlowCore | 채팅 메시지 + 스트리밍 |
| conversationStore | 대화 목록 + 활성 대화 |
| cronStore | 크론 작업 관리 |
| debugStore | 디버그 패널 (tool logs) |
| memoryStore | 메모리/다이제스트 |
| messageStore | 메시지 라우팅 |
| navigationStore | mainView 라우팅 (chat/team/cron/vault/network/agent/settings) |
| networkStore | 릴레이 연결, 연락처, 피어 채팅, 디렉토리, 메시지 필터링(showAllMessages) |
| settingsStore | API 키, 모델, 테마, 로케일 |
| skillStore | 활성 스킬 |
| streamStore / streamResponses | 스트리밍 응답 상태 |
| summaryStore | 대화 요약 |
| teamStore / teamRunStore / teamChatFlowStore | 팀 관리 + 팀 채팅 |
| toolExecution / toolRunStore | 도구 실행 상태 |
| tourStore | 가이드 투어 |
| vaultStore | Vault 노트 목록/내용 |

### 12.2 Component 구조
```
components/
├── agent/        # AgentEditor, AgentPanel, AgentMetadataForm, NativeToolPanel, CredentialPanel, AgentSkillsPanel, MarketplacePanel, AvatarUploader
├── chat/         # ChatWindow, ChatInput, ChatMessage, MessageBody, ToolRunBlock, ToolRunGroup, ConversationSwitcher
├── team/         # TeamPanel, TeamEditor, TeamChatWindow, TeamChatInput, TeamStatusBar
├── cron/         # CronPanel, CronEditor
├── vault/        # VaultPanel, NoteListPane, NoteDetailPane, GraphPane, GraphCanvas, NoteEditor, CreateNoteDialog
├── network/      # NetworkPanel, ContactList, ContactDetail, PeerThread, PeerChatInput, PeerMessageBubble, InviteDialog, DeliveryBadge
├── memory/       # MemoryPanel 등
├── settings/     # SettingsModal, ApiServerSection, RelayConfigSection, ProxySection, NetworkToggleSection
├── layout/       # MainLayout, Sidebar, DraggableHeader, WindowControls
├── onboarding/   # Onboarding 화면
├── tour/         # 가이드 투어 오버레이
├── skill/        # 스킬 관리
├── debug/        # 디버그 패널
└── common/       # Modal, ErrorBoundary 등
```

### 12.3 Services
```
services/
├── commands/          # Tauri invoke 래퍼 (agentCommands, apiCommands, browserCommands, chatCommands, credentialCommands, cronCommands, marketplaceCommands, memoryCommands, relayCommands, skillCommands, teamCommands, toolCommands, vaultCommands)
├── bootstrapService   # 앱 초기화
├── chatHelpers        # 메시지 빌드
├── consolidationService # 대화 요약/통합
├── conversationLifecycle # 대화 생성/삭제
├── heartbeatService   # 주기적 헬스체크
├── initService        # 시작 시 설정 로드
├── personaService     # 페르소나 관리
├── streamHelpers      # 스트림 파싱
├── toolService / toolRegistry / nativeToolRegistry # 도구 등록/관리
├── types.ts           # 공유 TypeScript 타입
└── logger.ts          # 로깅
```

### 12.4 Hooks
| Hook | 역할 |
|------|------|
| useAgentEditor | 에이전트 편집 로직 |
| useAttachmentSrc | 첨부파일 소스 관리 |
| useChatInputLogic | 채팅 입력 (전송, Enter/Shift+Enter 처리) |
| useClipboardFeedback | 클립보드 복사 피드백 |
| useCompositionInput | 한글 입력 조합(IME) 처리 |
| useDragRegion | Tauri 창 드래그 |
| useLoadOnOpen | 컴포넌트 열림 시 데이터 로드 |
| useMessageScroll | 메시지 영역 자동 스크롤 |

### 12.5 i18n
- **라이브러리:** i18next + react-i18next
- **지원 언어:** ko (한국어), en (영어)
- **Namespaces:** common, glossary, settings, onboarding, agent, chat, network, vault, prompts, team, cron
- **특수:** 한국어 조사 자동 선택 (이/가, 을/를, 은/는)
- **테마 변수:** ui_theme(org/classic)에 따라 용어 변경

---

## 13. Tauri Commands (전체 목록)

`lib.rs`의 `invoke_handler`에 등록된 모든 커맨드:

### Conversation
`create_conversation`, `create_team_conversation`, `get_conversations`, `get_conversation_detail`, `get_messages`, `save_message`, `delete_conversation`, `update_conversation_title`, `update_conversation_summary`, `delete_messages_and_maybe_reset_summary`, `set_learning_mode`, `update_conversation_skills`

### Agent
`create_agent`, `get_agent`, `list_agents`, `update_agent`, `delete_agent`, `write_agent_file`, `read_agent_file`, `sync_agents_from_fs`, `seed_manager_agent`, `refresh_default_manager_persona`, `resize_avatar`, `get_bootstrap_prompt`

### API / LLM
`has_api_key`, `has_stored_key`, `get_no_proxy`, `set_no_proxy`, `set_api_config`, `check_api_health`, `chat_completion`, `chat_completion_stream`, `abort_stream`, `bootstrap_completion`, `list_models`

### Config
`get_app_settings`, `set_app_settings`, `migrate_frontend_settings`, `get_env_config`

### Tool
`execute_tool`, `create_tool_call_log`, `list_tool_call_logs`, `update_tool_call_log_status`, `get_native_tools`, `get_default_tool_config`, `read_tool_config`, `write_tool_config`

### Credential
`list_credentials`, `add_credential`, `update_credential`, `remove_credential`

### Skill
`list_skills`, `read_skill`, `read_skill_resource`, `create_skill`, `update_skill`, `delete_skill`

### Marketplace
`marketplace_fetch_plugins`, `marketplace_fetch_plugin_skills`, `marketplace_install_skills`

### Memory
`create_memory_note`, `list_memory_notes`, `update_memory_note`, `delete_memory_note`, `read_consolidated_memory`, `write_consolidated_memory`, `read_digest`, `write_digest`, `update_conversation_digest`, `update_conversation_consolidated`, `list_pending_consolidations`, `archive_conversation_notes`

### Vault
`vault_create_note`, `vault_read_note`, `vault_update_note`, `vault_delete_note`, `vault_list_notes`, `vault_search`, `vault_get_graph`, `vault_get_backlinks`, `vault_get_path`, `vault_open_in_obsidian`, `vault_rebuild_index`, `vault_archive_note`, `vault_list_notes_with_decay`

### Browser
`approve_browser_domain`, `get_browser_artifact`, `get_browser_headless`, `set_browser_headless`, `get_browser_proxy`, `set_browser_proxy`, `get_browser_no_proxy`, `set_browser_no_proxy`, `detect_system_proxy`, `detect_system_no_proxy`, `get_shell_info`, `get_workspace_path`

### Relay / Network
`relay_start`, `relay_stop`, `relay_status`, `relay_generate_invite`, `relay_accept_invite`, `relay_list_contacts`, `relay_update_contact`, `relay_remove_contact`, `relay_approve_contact`, `relay_reject_contact`, `relay_bind_agent`, `relay_send_message`, `relay_list_threads`, `relay_get_thread`, `relay_get_thread_messages`, `relay_delete_thread`, `relay_clear_thread_messages`, `relay_get_peer_id`, `relay_get_network_enabled`, `relay_set_network_enabled`, `relay_get_connection_info`, `relay_get_relay_url`, `relay_set_relay_url`, `relay_get_allowed_tools`, `relay_set_allowed_tools`, `relay_search_directory`, `relay_send_friend_request`, `relay_update_directory_profile`, `relay_get_directory_settings`, `relay_set_directory_settings`

### Team
`create_team`, `get_team_detail`, `list_teams`, `update_team`, `delete_team`, `add_team_member`, `remove_team_member`, `create_team_run`, `update_team_run_status`, `get_team_run`, `get_running_runs`, `create_team_task`, `update_team_task`, `get_team_tasks`, `abort_team_run`, `execute_delegation`, `handle_team_report`

### Cron
`create_cron_job`, `list_cron_jobs`, `list_cron_jobs_for_agent`, `get_cron_job`, `update_cron_job`, `delete_cron_job`, `toggle_cron_job`, `list_cron_runs`

### Export/Import
`export_agent`, `import_agent`

### Misc
`read_file_base64`, `save_chat_image`

---

## 14. Native Tools

에이전트가 LLM tool_calls로 사용할 수 있는 내장 도구 목록. `TOOL_CONFIG.json`의 permission_tier와 allowed/denied 리스트로 에이전트별 접근 제어.

### 14.1 도구 목록 (17개)

| 도구 | 설명 | Tier | Timeout |
|------|------|------|---------|
| **read_file** | 파일 읽기 (scope: workspace/persona/vault) | auto | 30s |
| **write_file** | 파일 쓰기 | confirm | 30s |
| **delete_file** | 파일 삭제 | confirm | 30s |
| **list_directory** | 디렉토리 목록 (recursive 옵션) | auto | 30s |
| **web_search** | 웹 페이지 가져오기 (url 또는 query) | confirm | 30s |
| **browser_navigate** | URL로 이동 → 페이지 스냅샷 반환 | confirm | 360s |
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

### 14.2 Permission Tier
- **auto**: 사용자 확인 없이 자동 실행
- **confirm**: 실행 전 사용자 승인 필요 (프론트엔드에서 approval UI 표시)

### 14.3 File Scope
| Scope | 경로 | 용도 |
|-------|------|------|
| workspace | `vault/{agent_id}/workspace/` | 대화별 작업 파일 |
| persona | `agents/{folder_name}/` | 에이전트 정체성 파일 (화이트리스트 제한) |
| vault | `vault/{agent_id}/{category}/` | 장기 메모리 (knowledge/decision/conversation/reflection) |

### 14.4 Credential in Tools
- `browser_type`에서 `{{credential:KEY}}` 문법으로 비밀번호 자동 입력
- `run_shell`에서 credential 접근 2가지 방식 병행:
  - `CRED_*` 환경변수 자동 주입 (예: `$CRED_GITHUB_TOKEN`)
  - `{{credential:KEY}}` 인라인 치환 (command 문자열에서 직접 치환)
- 실행 결과에서 credential 값 자동 redact (환경변수/인라인 모두)
- 자동 승인 정책: `auto_approve=true`일 때 `run_shell`도 자동 승인 (credential 유무 무관). `browser_type`은 `{{credential:*}}` placeholder 사용 시에만 confirm 유지. `manage_schedule`은 항상 confirm.

---

## 15. System Prompt Construction

`build_system_prompt(resolved, scope)` 함수가 다음 순서로 조립한다:

1. **기본 시스템 프롬프트** — persona 파일 조합 (IDENTITY + SOUL + USER + AGENTS)
2. **등록된 에이전트 섹션** — manager agent만 (다른 에이전트 목록)
3. **Vault 가이드** — `write_file` 활성 AND (memory OR learning_mode) 시
4. **Learning Mode 프롬프트** — 활성 시 요약/메모리 연결/질문 지시
5. **통합 메모리** — `[CONSOLIDATED MEMORY]\n{내용}`
6. **도구 섹션** — 활성 도구 설명
7. **자격증 섹션** — credential 키 목록 (값은 미포함)
8. **역할 지시** — role별 행동 지침:
   - CronExecution: 스케줄된 작업 완수 지시
   - TeamMember: `report` 도구로 결과 보고 지시
   - TeamLeaderSynthesis: 보고서 종합 지시
   - RelayResponse: 자연스러운 메시지 응답 지시
9. **피어 컨텍스트** (RelayResponse only) — secretary가 자동응답 시 추가:
   ```
   [PEER CONTEXT]
   You are conversing with an external peer (from another organization/user).
   - Peer display name: {display_name}
   - Peer agent: {agent_name} ({agent_description})
   ```

---

## 16. Streaming Protocol

### 16.1 스트림 시작
```
chat_completion_stream(request) → request_id 반환
  → tokio task 생성 + RunRegistry에 AbortHandle 등록
  → SSE 스트림 시작 (POST /chat/completions, stream: true)
```

### 16.2 이벤트 포맷
```
"chat-stream-chunk": {
  request_id: String,
  delta: String,              // content 텍스트 조각
  reasoning_delta?: String,   // thinking 텍스트 조각
  tool_calls_delta?: [...]    // tool_call 인덱스별 조각
}

"chat-stream-done": {
  request_id: String,
  full_content: String,
  reasoning_content?: String,
  tool_calls?: ToolCall[],
  error?: String
}
```

### 16.3 중단
- `abort_stream(request_id)` → AbortHandle.abort() → task 즉시 중단
- `chat-stream-done` 이벤트 발행 (error: "aborted")

### 16.4 Thinking 폴백
1. `thinking_enabled=true`로 시작
2. HTTP 400/422 + "thinking" 키워드 감지 → thinking 제거 후 재시도
3. 성공한 첫 tool loop 이후에도 thinking 제거 (안정성)

---

## 17. Tauri Events

앱 내부에서 `app_handle.emit()`으로 발행되는 모든 이벤트:

### Chat/Stream
| 이벤트 | 페이로드 |
|--------|---------|
| `chat-stream-chunk` | { request_id, delta, reasoning_delta?, tool_calls_delta? } |
| `chat-stream-done` | { request_id, full_content, reasoning_content?, tool_calls?, error? } |

### Relay/Network
| 이벤트 | 페이로드 |
|--------|---------|
| `relay:connection-state` | { status, peer_count } |
| `relay:presence` | { peer_id, status } |
| `relay:delivery-update` | { message_id, state } |
| `relay:incoming-message` | { peer_id, thread_id, message_id } |
| `relay:contact-accepted` | { contact_id, peer_id } |
| `relay:approval-needed` | { peer_id, agent_name, type } |
| `relay:auto-response-started` | { thread_id } |
| `relay:auto-response-completed` | { thread_id } |
| `relay:auto-response-error` | { thread_id, error } |
| `relay:directory-result` | { query, peers, total, offset } |
| `relay:profile-updated` | { discoverable } |
| `relay:peer-profile` | { peer } |
| `relay:error` | { code, message } |

### Vault
| 이벤트 | 페이로드 |
|--------|---------|
| `vault:note-changed` | 노트 변경 정보 |
| `vault:note-removed` | 노트 삭제 정보 |

### Settings
| 이벤트 | 페이로드 |
|--------|---------|
| `settings:changed` | 변경된 설정 JSON |

### Debug
| 이벤트 | 페이로드 |
|--------|---------|
| `debug:http-log` | { id, method, url, status, duration_ms, ... } |

---

## 18. Error System

### 18.1 AppError Variants
```rust
enum AppError {
    Database(String),
    Api(String),
    Validation(String),
    Io(String),
    NotFound(String),
    Relay(String),
    Vault(String),
    Config(String),
    Lock(String),
    Json(String),
}
```

### 18.2 자동 변환 (From)
- `DbError` → `Database`
- `reqwest::Error` → `Api`
- `std::io::Error` → `Io`
- `serde_json::Error` → `Json`
- `String` → `Io`

### 18.3 프론트엔드 수신
Tauri invoke 에러 시 `AppError.to_string()` 문자열로 수신. 예: `"Database error: UNIQUE constraint failed"`.

---

## 19. Frontend Chat Flow

### 19.1 메시지 전송 흐름 (도구 반복 루프)
```
사용자 메시지 입력
  → ensureConversation() (없으면 생성)
  → BOOT.md 로드 (새 대화만)
  → 첨부파일 저장 (saveChatImage → 디스크 경로)
  → saveMessage(role: "user")
  → runToolLoop():
      Iteration 0..10:
        streamOneTurn():
          → pre-compaction 체크 (토큰 추정, 75% 초과 시 flush)
          → buildConversationContext() (messages + summary + memory + vault + skills)
          → chatCompletionStream() → 청크 수신

        tool_calls 없음? → saveFinalResponse() → 종료
        tool_calls 있음?
          → classifyToolCalls() (auto/confirm/deny)
          → denied: "Tool denied" 메시지
          → confirm: waitForToolApproval() (사용자 대기)
          → executeToolCalls() → 결과 저장
          → refreshStores (vault/persona 변경 감지)
          → 다음 iteration
```

### 19.2 Bootstrap 흐름 (새 에이전트 생성)
```
사용자가 "에이전트 설명" 입력
  → get_bootstrap_prompt(locale) → 부트스트랩 프롬프트
  → executeBootstrapTurn() (max 5 iterations):
      → LLM 호출 (tools: write_file, read_file만)
      → tool_calls → 파일 작성 (IDENTITY.md, SOUL.md 등)
      → 반복
  → isBootstrapComplete() 확인 (4개 필수 파일)
  → completeBootstrap() → 에이전트 생성 완료
```

---

## 20. UI Theme System

### 20.1 테마 유형
- **org** (조직형): 에이전트를 "직원"으로, 관리를 "인사관리"로 표현
- **classic** (에이전트형): 기존 AI 에이전트 용어 사용

### 20.2 주요 용어 차이

| 개념 | org | classic |
|------|-----|---------|
| 에이전트 | 직원 (Employee) | 에이전트 (Agent) |
| 기본 에이전트 | 팀장 (Team Lead) | 매니저 (Manager) |
| 새로 만들기 | 채용하기 (Hire) | 새 에이전트 (New Agent) |
| 삭제 | 해고하기 (Fire) | 삭제 (Delete) |
| 관리 메뉴 | 인사관리 (HR) | 에이전트 편집 (Edit) |
| 페르소나 탭 | 인적사항/성격/매니저정보/업무규칙/업무도구 | IDENTITY/SOUL/USER/AGENTS/TOOLS |

### 20.3 적용 방식
```javascript
t("glossary:agent", { context: uiTheme })  // "org" → "직원", "classic" → "에이전트"
```

---

## 21. Onboarding

### 21.1 단계
1. **Language** — 로케일 선택 (ko/en)
2. **Setup** — 회사 이름 + UI 테마 선택 → manager agent 시드
3. **Templates** — 에이전트 템플릿 선택 (옵션)
4. **API** — LLM API 키 + Base URL 입력

### 21.2 branding_initialized 플래그
- `false`: Onboarding 표시 (fresh install)
- `true`: Onboarding 스킵
- 기존 설치 업그레이드 시 자동으로 `true` 설정

---

## 22. Attachment System

### 22.1 포맷
```typescript
interface Attachment {
  type: "image";
  path: string;        // 디스크 경로 (저장 후)
  mime?: string;
  dataUrl?: string;    // In-memory data URL (UI 렌더링용, DB에 저장 안 함)
}
```

### 22.2 흐름
```
사용자 이미지 첨부 → pendingAttachments에 dataUrl로 보관
  → 메시지 전송 시 saveChatImage(base64) → 디스크 경로 반환
  → saveMessage({ attachments: JSON.stringify([{ type, path }]) })
  → DB에서 로드 시 useAttachmentSrc(att) → readFileBase64(path) → data URL 변환
```

---

## 23. Conversation Lifecycle

### 23.1 요약/통합 흐름
```
세션 종료 (다른 대화로 전환 또는 앱 종료)
  → triggerConsolidation():
      [Step 1] generateDigest():
        최근 30개 메시지 + vault 노트 + 파일 활동 수집
        → LLM으로 digest 생성 → writeDigest()
      [Step 2] consolidateMemory():
        기존 메모리 + 새 digest → LLM으로 병합
        → writeConsolidatedMemory(version: N+1)
```

### 23.2 Pre-compaction
- 토큰 추정이 모델 한도의 75% 초과 시 발동
- 오래된 메시지 요약 + 삭제/압축으로 컨텍스트 윈도우 관리
