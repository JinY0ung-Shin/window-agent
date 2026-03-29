# Database Schema

단일 SQLite DB (`chat.db`), WAL 모드, `SCHEMA_VERSION = 1` + incremental migrations.

---

## 1. 테이블 스키마

### 1.1 agents

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

인덱스: 없음 (PK + UNIQUE 제약이 자동 인덱스 역할)

---

### 1.2 conversations

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

인덱스:
- `idx_conversations_agent_id ON conversations(agent_id)`

---

### 1.3 messages

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

인덱스:
- `idx_messages_conversation_id ON messages(conversation_id)`
- `idx_messages_created_at ON messages(created_at)`

---

### 1.4 tool_call_logs

```sql
CREATE TABLE tool_call_logs (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id       TEXT REFERENCES messages(id) ON DELETE SET NULL,
    tool_name        TEXT NOT NULL,
    tool_input       TEXT NOT NULL,
    tool_output      TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',  -- pending | executed | error
    duration_ms      INTEGER,
    artifact_id      TEXT,
    agent_id         TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

인덱스:
- `idx_tool_call_logs_conversation ON tool_call_logs(conversation_id)`

---

### 1.5 browser_artifacts

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
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

인덱스:
- `idx_browser_artifacts_conversation ON browser_artifacts(conversation_id)`

---

### 1.6 contacts

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
    capabilities_json     TEXT NOT NULL DEFAULT '{"can_send_messages":true,"can_read_agent_info":true,"can_request_tasks":false,"can_access_tools":false,"can_write_vault":false}',
    status                TEXT NOT NULL DEFAULT 'pending',
      -- pending | accepted | pending_approval | pending_outgoing | rejected
    invite_card_raw       TEXT,
    addresses_json        TEXT,
    published_agents_json TEXT,              -- 상대방의 공개 에이전트 목록 JSON
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
```

인덱스:
- `idx_contacts_peer_id ON contacts(peer_id)`
- `idx_contacts_local_agent ON contacts(local_agent_id)`

---

### 1.7 peer_threads

```sql
CREATE TABLE peer_threads (
    id              TEXT PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    local_agent_id  TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title           TEXT NOT NULL DEFAULT '',
    summary         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

인덱스:
- `idx_peer_threads_contact ON peer_threads(contact_id)`

---

### 1.8 peer_messages

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
    delivery_state      TEXT NOT NULL DEFAULT 'pending',
      -- pending | queued | sent | delivered
    retry_count         INTEGER NOT NULL DEFAULT 0,
    raw_envelope        TEXT,
    target_agent_id     TEXT,                -- 상대방이 선택한 대상 에이전트
    responding_agent_id TEXT,                -- 실제 응답한 에이전트
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

인덱스:
- `idx_peer_messages_thread ON peer_messages(thread_id)`
- `idx_peer_messages_unique ON peer_messages(message_id_unique)`

---

### 1.9 outbox

```sql
CREATE TABLE outbox (
    id              TEXT PRIMARY KEY,
    peer_message_id TEXT NOT NULL REFERENCES peer_messages(id) ON DELETE CASCADE,
    target_peer_id  TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_retry_at   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

인덱스:
- `idx_outbox_status ON outbox(status)`
- `idx_outbox_target ON outbox(target_peer_id)`

---

### 1.10 teams

```sql
CREATE TABLE teams (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    leader_agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

인덱스: 없음

---

### 1.11 team_members

```sql
CREATE TABLE team_members (
    id        TEXT PRIMARY KEY,
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member',  -- leader | member
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, agent_id)
);
```

인덱스:
- `idx_team_members_team ON team_members(team_id)`
- `idx_team_members_agent ON team_members(agent_id)`

---

### 1.12 team_runs

```sql
CREATE TABLE team_runs (
    id               TEXT PRIMARY KEY,
    team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    leader_agent_id  TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'running',
      -- running | waiting_reports | synthesizing | completed | failed | cancelled
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at      TEXT
);
```

인덱스:
- `idx_team_runs_team ON team_runs(team_id)`
- `idx_team_runs_conversation ON team_runs(conversation_id)`
- `idx_team_runs_status ON team_runs(status)`

---

### 1.13 team_tasks

```sql
CREATE TABLE team_tasks (
    id                TEXT PRIMARY KEY,
    run_id            TEXT NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
    agent_id          TEXT NOT NULL,
    request_id        TEXT,                  -- RunRegistry request ID (스트림 중단용)
    task_description  TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'queued',
      -- queued | running | completed | failed | cancelled
    parent_message_id TEXT,
    result_summary    TEXT,
    started_at        TEXT,
    finished_at       TEXT
);
```

인덱스:
- `idx_team_tasks_run ON team_tasks(run_id)`
- `idx_team_tasks_status ON team_tasks(status)`

---

### 1.14 cron_jobs

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
    last_result     TEXT CHECK(last_result IN ('success','failed') OR last_result IS NULL),
    last_error      TEXT,
    run_count       INTEGER NOT NULL DEFAULT 0,
    claimed_at      TEXT,                    -- 중복 실행 방지
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
```

인덱스:
- `idx_cron_jobs_agent ON cron_jobs(agent_id)`
- `idx_cron_jobs_enabled ON cron_jobs(enabled)`
- `idx_cron_jobs_next_run ON cron_jobs(next_run_at)`

---

### 1.15 cron_runs

```sql
CREATE TABLE cron_runs (
    id              TEXT PRIMARY KEY,
    job_id          TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    agent_id        TEXT NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('running','success','failed')) DEFAULT 'running',
    prompt          TEXT NOT NULL,
    result_summary  TEXT,
    error           TEXT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT
);
```

인덱스:
- `idx_cron_runs_job ON cron_runs(job_id)`

---

### 1.16 _schema_version

```sql
CREATE TABLE _schema_version (
    version INTEGER PRIMARY KEY
);
```

내부 관리 테이블. 현재 `SCHEMA_VERSION = 1`.

---

## 2. FK CASCADE 관계도

```
agents
  |
  +--[CASCADE]--> conversations
  |                  |
  |                  +--[CASCADE]--> messages
  |                  +--[CASCADE]--> tool_call_logs
  |                  +--[CASCADE]--> browser_artifacts
  |                  +--[SET NULL]-- team_runs.conversation_id (via conversations)
  |
  +--[CASCADE]--> teams (via leader_agent_id)
  |                  |
  |                  +--[CASCADE]--> team_members
  |                  +--[CASCADE]--> team_runs
  |                                    |
  |                                    +--[CASCADE]--> team_tasks
  |
  +--[CASCADE]--> cron_jobs
  |                  |
  |                  +--[CASCADE]--> cron_runs
  |
  +--[SET NULL]--> contacts.local_agent_id
  +--[SET NULL]--> peer_threads.local_agent_id
  +--[CASCADE]--> team_members (via agent_id)

contacts
  |
  +--[CASCADE]--> peer_threads
                     |
                     +--[CASCADE]--> peer_messages
                                        |
                                        +--[CASCADE]--> outbox

conversations
  +--[SET NULL]-- teams (via team_id)

messages
  +--[SET NULL]-- tool_call_logs.message_id
```

**삭제 전파 체인:**
- `DELETE agents` -> conversations -> messages, tool_call_logs, browser_artifacts
- `DELETE agents` -> teams -> team_members, team_runs -> team_tasks
- `DELETE agents` -> cron_jobs -> cron_runs
- `DELETE contacts` -> peer_threads -> peer_messages -> outbox

---

## 3. Incremental Migration 패턴

스키마 변경은 `SCHEMA_VERSION`을 올리지 않고, `run_incremental_migrations()` 함수에서 idempotent하게 처리한다.

### 동작 방식

1. `ensure_schema()` 호출 시 `create_schema()` (IF NOT EXISTS) + `run_incremental_migrations()` 순서로 실행
2. 각 마이그레이션은 `PRAGMA table_info(table_name)`으로 컬럼 존재 여부를 먼저 확인
3. 컬럼이 없으면 `ALTER TABLE ADD COLUMN` 실행
4. 새 테이블은 `SELECT name FROM sqlite_master WHERE type='table'`로 존재 여부 확인 후 생성
5. 모든 마이그레이션은 재실행해도 안전 (idempotent)

### 마이그레이션 이력

| 대상 | 변경 내용 |
|------|----------|
| conversations | `learning_mode`, `digest_id`, `consolidated_at`, `team_id` 컬럼 추가 |
| messages | `sender_agent_id`, `team_run_id`, `team_task_id`, `attachments` 컬럼 추가 |
| tool_call_logs | `agent_id` 컬럼 추가 |
| agents | `network_visible` 컬럼 추가 |
| peer_messages | `target_agent_id`, `responding_agent_id` 컬럼 추가 |
| contacts | `published_agents_json` 컬럼 추가 |
| cron_jobs | `claimed_at` 컬럼 추가 (기존 테이블 업그레이드) |
| teams, team_members, team_runs, team_tasks | 테이블 전체 생성 |
| cron_jobs, cron_runs | 테이블 전체 생성 |
