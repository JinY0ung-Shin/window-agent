# Window Agent -- System Specification

> AI 에이전트 기반 데스크톱 어시스턴트. 여러 에이전트를 생성하고, 도구를 사용하며, 브라우저 자동화를 수행하고, 릴레이 네트워크를 통해 에이전트 간 통신을 지원한다.

**Version:** 0.14.2
**Last Updated:** 2026-03-29

---

## Spec 파일 인덱스

| 파일 | 설명 |
|------|------|
| [index.md](index.md) | 아키텍처 개요, Tech Stack, 앱 시작 순서, 에러/이벤트 참조 |
| [database.md](database.md) | SQLite 스키마, 인덱스, FK 관계, incremental migration |
| [agent.md](agent.md) | 에이전트 시스템, Persona, Tools, Credentials, Skills, System Prompt |
| [conversation.md](conversation.md) | 대화 시스템, LLM 파이프라인, Streaming, Tool Loop, Lifecycle |

---

## 1. 프로젝트 구조

```
window-agent/
├── src/                  # Frontend (React 19 + TypeScript + Vite)
│   ├── components/       # UI 컴포넌트 (agent, chat, team, cron, vault, network, ...)
│   ├── stores/           # Zustand 상태 관리
│   ├── services/         # Tauri invoke 래퍼, 비즈니스 로직
│   ├── hooks/            # React 커스텀 훅
│   ├── i18n/             # 다국어 (ko, en)
│   └── data/             # 정적 데이터 (에이전트 템플릿 등)
├── src-tauri/            # Backend (Tauri 2 + Rust)
│   ├── src/
│   │   ├── commands/     # Tauri invoke handler
│   │   ├── db/           # SQLite 스키마/마이그레이션/모델/operations
│   │   ├── services/     # actor_context, credential, llm_helpers, ...
│   │   ├── relay/        # 릴레이 네트워크 (WebSocket, E2E 암호화)
│   │   ├── browser/      # BrowserManager, sidecar 통신
│   │   ├── cron/         # CronScheduler
│   │   ├── memory/       # SystemMemoryManager
│   │   ├── vault/        # VaultManager, VaultWatcher
│   │   ├── team/         # TeamOrchestrator
│   │   └── utils/        # config_helpers, ...
│   └── resources/        # 번들 리소스 (로케일별 기본 에이전트 페르소나)
├── relay-server/         # Relay Server (Rust, axum + WebSocket)
├── shared/               # Client-Server 공유 프로토콜 (Rust crate)
└── browser-sidecar/      # Browser Automation (Node.js + Playwright)
```

---

## 2. Tech Stack

| 레이어 | 기술 |
|--------|------|
| **Frontend** | React 19, TypeScript, Zustand (state), i18next (i18n), Vite |
| **Backend** | Tauri 2, Rust, SQLite (rusqlite, WAL mode), tokio (async) |
| **Relay Server** | axum, sqlx (async SQLite), tokio-tungstenite (WebSocket) |
| **Shared** | serde JSON 프로토콜 (tagged enum) |
| **Browser** | Playwright (Node.js sidecar process, HTTP API) |
| **Crypto** | ed25519-dalek, x25519-dalek, chacha20poly1305, hkdf |

---

## 3. Managed State (Tauri setup)

앱 시작 시 다음 상태가 `app.manage()`로 등록된다:

| State | 설명 |
|-------|------|
| `Database` | SQLite 연결 (chat.db) |
| `ApiState` | LLM API 키/URL + RunRegistry (스트림 중단용) |
| `AppSettings` | 통합 설정 (3개 store 파일: app-settings.json, relay-settings.json, browser-config.json) |
| `NodeIdentity` | Ed25519 키쌍 (relay-identity.json) |
| `RelayManager` | 네트워크 상태 머신 |
| `SystemMemoryManager` | 에이전트 메모리 파일 관리 |
| `VaultState` | Mutex\<VaultManager\> (Markdown 노트 관리) |
| `VaultWatcher` | 외부 편집 동기화 (300ms polling) |
| `BrowserManager` | Playwright sidecar + 세션 관리 |
| `CronScheduler` | 백그라운드 cron 스케줄러 |
| `RunRegistry` | 활성 스트림/팀 실행 추적 |

---

## 4. 앱 시작 순서

### 4.1 Backend (lib.rs setup)

```
 1. .env 로드 (dotenvy)
 2. tracing 초기화
 3. DB 열기 + 스키마 마이그레이션 (ensure_schema)
 4. ApiState, AppSettings 로드
 5. Legacy store 마이그레이션 (p2p -> relay)
 6. VaultManager + VaultWatcher 초기화
 7. NodeIdentity + RelayManager 초기화 (dormant)
 8. SystemMemoryManager 초기화
 9. 정체된 TeamRun 복구 (TeamOrchestrator::recover_runs)
10. CronScheduler 백그라운드 루프 시작
11. BrowserManager + idle cleanup 시작
```

### 4.2 Frontend (initService.ts)

```
 1. Settings 로드 (localStorage 캐시 -> 즉시)
 2. Fresh-install 신호 스냅샷 (loadEnvDefaults 전)
 3. Backend hydration (loadEnvDefaults -> localStorage 마이그레이션 + 캐싱)
 4. 기존 설치 판별
    - 기존 설치: seedManagerAgent(locale) + refreshDefaultManagerPersona(locale)
 5. FS Sync (syncAgentsFromFs)
 6. Agent 목록 로드 (loadAgents)
 7. Conversation 목록 로드 (loadConversations)
    7b. Team 목록 로드 (loadTeams)
    7c. Cron Jobs 로드 + 이벤트 리스너 설정
 8. 레거시 사용자 자동 branding 초기화 (brandingInitialized 플래그)
 9. Heartbeat lifecycle 등록 (registerHeartbeatLifecycle)
10. Consolidation 복구 (initConsolidationRecovery -- 비동기, 논블로킹)
11. appReady = true, app:ready 이벤트 발행
```

---

## 5. AppError Enum

통합 애플리케이션 에러 타입. Tauri 커맨드 경계에서 plain string으로 직렬화된다.

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),
    #[error("API error: {0}")]
    Api(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Relay error: {0}")]
    Relay(String),
    #[error("Vault error: {0}")]
    Vault(String),
    #[error("Config error: {0}")]
    Config(String),
    #[error("Lock error: {0}")]
    Lock(String),
    #[error("JSON error: {0}")]
    Json(String),
}
```

### 자동 변환 (From)

| Source | Target Variant |
|--------|---------------|
| `DbError` (Sqlite) | `Database` |
| `reqwest::Error` | `Api` |
| `std::io::Error` | `Io` |
| `serde_json::Error` | `Json` |
| `String` | `Io` |

### 프론트엔드 수신

Tauri invoke 에러 시 `AppError.to_string()` 문자열로 수신.
예: `"Database error: UNIQUE constraint failed"`.

---

## 6. Tauri Events

앱 내부에서 `app_handle.emit()`으로 발행되는 모든 이벤트.

### Chat / Stream

| 이벤트 | 페이로드 |
|--------|---------|
| `chat-stream-chunk` | `{ request_id, delta, reasoning_delta?, tool_calls_delta? }` |
| `chat-stream-done` | `{ request_id, full_content, reasoning_content?, tool_calls?, error? }` |

### Relay / Network

| 이벤트 | 페이로드 |
|--------|---------|
| `relay:connection-state` | `{ status, peer_count }` |
| `relay:presence` | `{ peer_id, status }` |
| `relay:delivery-update` | `{ message_id, state }` |
| `relay:incoming-message` | `{ peer_id, thread_id, message_id }` |
| `relay:contact-accepted` | `{ contact_id, peer_id }` |
| `relay:approval-needed` | `{ peer_id, agent_name, type }` |
| `relay:auto-response-started` | `{ thread_id }` |
| `relay:auto-response-completed` | `{ thread_id }` |
| `relay:auto-response-error` | `{ thread_id, error }` |
| `relay:directory-result` | `{ query, peers, total, offset }` |
| `relay:profile-updated` | `{ discoverable }` |
| `relay:peer-profile` | `{ peer }` |
| `relay:error` | `{ code, message }` |

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
| `debug:http-log` | `{ id, method, url, status, duration_ms, ... }` |

---

## 7. Tauri Commands (전체 목록)

`lib.rs`의 `invoke_handler`에 등록된 모든 커맨드.

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
