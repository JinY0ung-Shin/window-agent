# Team System

> 여러 에이전트를 하나의 팀으로 구성하여 리더가 작업을 위임하고, 멤버가 보고한 결과를 리더가 합성(synthesis)하는 협업 시스템.

---

## 1. DB Schema

### 1.1 teams

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

별도 인덱스 없음 (PK 인덱스만 존재).

### 1.2 team_members

```sql
CREATE TABLE team_members (
    id        TEXT PRIMARY KEY,
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member',   -- 'leader' | 'member'
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, agent_id)
);
CREATE INDEX idx_team_members_team  ON team_members(team_id);
CREATE INDEX idx_team_members_agent ON team_members(agent_id);
```

### 1.3 team_runs

```sql
CREATE TABLE team_runs (
    id               TEXT PRIMARY KEY,
    team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    leader_agent_id  TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'running',
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at      TEXT
);
CREATE INDEX idx_team_runs_team         ON team_runs(team_id);
CREATE INDEX idx_team_runs_conversation ON team_runs(conversation_id);
CREATE INDEX idx_team_runs_status       ON team_runs(status);
```

### 1.4 team_tasks

```sql
CREATE TABLE team_tasks (
    id                TEXT PRIMARY KEY,
    run_id            TEXT NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
    agent_id          TEXT NOT NULL,
    request_id        TEXT,                   -- RunRegistry request ID (스트림 중단용)
    task_description  TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'queued',
    parent_message_id TEXT,
    result_summary    TEXT,
    started_at        TEXT,
    finished_at       TEXT
);
CREATE INDEX idx_team_tasks_run    ON team_tasks(run_id);
CREATE INDEX idx_team_tasks_status ON team_tasks(status);
```

### 1.5 conversations / messages 확장 컬럼

팀 모드를 지원하기 위해 기존 테이블에 다음 컬럼이 추가된다 (incremental migration):

| 테이블 | 컬럼 | 설명 |
|--------|------|------|
| conversations | `team_id` | `REFERENCES teams(id) ON DELETE SET NULL` |
| messages | `sender_agent_id` | 팀 모드에서 메시지 발신 에이전트 |
| messages | `team_run_id` | 소속 TeamRun |
| messages | `team_task_id` | 소속 TeamTask |

---

## 2. Team Orchestrator 흐름

### 2.1 execute_delegation

리더가 `delegate` 도구를 호출하면 프론트엔드가 `execute_delegation` Tauri 커맨드를 실행한다.

```
execute_delegation(app, db, conversation_id, run_id, agent_ids, task, context)
  1. spawn_agent_tasks() 호출 — 각 agent_id별로:
     a. team_task 생성 (status: queued)
     b. ExecutionScope 구성 (role: TeamMember, trigger: BackendTriggered)
     c. actor_context::resolve_for_conversation()로 persona/tools/memory 해석
     d. task status → running, request_id 할당
     e. LLM request body 구성 (system_prompt + tools + task instruction)
     f. tokio::spawn → stream_completion()
     g. RunRegistry에 등록 (abort 지원)
  2. TeamRun status → waiting_reports
  3. 생성된 task_id 목록 반환
```

### 2.2 handle_team_report

멤버가 `report` 도구를 호출하면 해당 task가 완료로 전환되고, 모든 task 완료 여부를 확인한다.

```
handle_team_report(app, db, run_id, task_id, summary, details)
  1. team_task 업데이트 (status: completed, result_summary 저장)
  2. check_and_synthesize() 호출:
     a. 해당 run의 모든 task가 완료/실패/취소인지 확인
     b. 아직 미완료 task 있으면 false 반환 (대기 계속)
     c. 모든 task 완료 → TeamRun status → synthesizing
     d. 완료된 task의 report 수집 → team-all-reports-in 이벤트 emit
     e. Leader의 ExecutionScope (role: TeamLeaderSynthesis) 구성
     f. reports_text 빌드 → LLM synthesis stream 시작
     g. stream 완료 후 → TeamRun status → completed (실패 시 failed)
     h. team-leader-synthesis-done 이벤트 emit
```

### 2.3 abort_team_run

실행 중인 팀 작업을 강제 중단한다.

```
abort_team_run(app, db, registry, run_id)
  1. 해당 run의 모든 task 조회
  2. running/queued task에 대해:
     a. request_id 있으면 RunRegistry.abort() 호출
     b. task status → cancelled
  3. TeamRun status → cancelled
  4. team-run-cancelled 이벤트 emit
```

---

## 3. TeamRun 상태 머신

```
running ──(delegate 완료)──→ waiting_reports
                                  │
                          (모든 task 완료)
                                  │
                                  ▼
                            synthesizing
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼               ▼
               completed       failed         cancelled
```

| 상태 | 설명 |
|------|------|
| `running` | 초기 상태. 리더가 delegate 전 |
| `waiting_reports` | delegate 후 멤버 보고 대기 중 |
| `synthesizing` | 모든 보고 수신 완료, 리더가 합성 LLM 호출 중 |
| `completed` | 합성 완료 (정상 종료) |
| `failed` | 합성 실패 또는 복구 시 전환 |
| `cancelled` | abort_team_run()으로 강제 중단 |

### TaskStatus 상태

```
queued → running → completed
                 → failed
                 → cancelled
```

---

## 4. Leader-Member 역할별 도구 제한

`ExecutionRole`에 따라 LLM에 제공되는 도구 목록이 달라진다.

| ExecutionRole | 제한 사항 |
|---------------|----------|
| `TeamLeader` | `delegate` 도구 사용 가능, 일반 도구도 사용 가능 |
| `TeamMember` | `delegate` 사용 불가, `report` 도구 필수 사용, 일반 도구 사용 가능 |
| `TeamLeaderSynthesis` | 합성 전용 — 도구 없음, reports_text를 user 메시지로 받아 텍스트 합성 |

멤버 task 실행 시 시스템 프롬프트에 `role_instruction(TeamMember)` 지시문이 추가되어 반드시 `report` 도구로 결과를 보고하도록 유도한다.

---

## 5. 앱 시작 시 복구 (recover_runs)

```rust
TeamOrchestrator::recover_runs(db)
```

앱 시작 시 호출되어 비정상 종료 시 정체된 TeamRun을 정리한다:

1. `status = 'running'`인 모든 TeamRun 조회
2. 각 run의 `running` 또는 `queued` task를 `failed`로 전환
   - `result_summary`: `"Recovered on startup -- previous run interrupted"`
3. TeamRun을 `failed`로 전환 (finished_at 설정)
4. 복구된 run 수 반환 (로깅용)

이미 `completed`인 run이나 task는 건드리지 않는다.

---

## 6. Tauri 이벤트

| 이벤트명 | 페이로드 | 발생 시점 |
|----------|---------|----------|
| `team-agent-stream-done` | `{ run_id, task_id, agent_id, content, error? }` | 멤버 LLM 스트림 완료/실패 |
| `team-all-reports-in` | `{ run_id, reports[] }` | 모든 task 완료, 합성 시작 전 |
| `team-leader-synthesis-done` | `{ run_id, request_id, error? }` | 합성 스트림 완료/실패 |
| `team-run-cancelled` | `{ run_id }` | abort_team_run() 실행 시 |
| `completion-chunk` | 스트리밍 청크 | 합성 및 멤버 LLM 스트리밍 중 |

---

## 7. Tauri 커맨드 목록

### Team CRUD

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `create_team` | `CreateTeamRequest { name, description?, leader_agent_id, member_agent_ids? }` | `Team` |
| `get_team_detail` | `team_id: String` | `TeamDetail { team, members[] }` |
| `list_teams` | (없음) | `Vec<Team>` |
| `update_team` | `team_id, UpdateTeamRequest { name?, description?, leader_agent_id? }` | `Team` |
| `delete_team` | `team_id: String` | `()` |

### Member 관리

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `add_team_member` | `team_id, agent_id, role` | `TeamMember` |
| `remove_team_member` | `team_id, agent_id` | `()` |

### Run 관리

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `create_team_run` | `team_id, conversation_id, leader_agent_id` | `TeamRun` |
| `update_team_run_status` | `run_id, status: TeamRunStatus, finished_at?` | `()` |
| `get_team_run` | `run_id` | `TeamRun` |
| `get_running_runs` | (없음) | `Vec<TeamRun>` |

### Task 관리

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `create_team_task` | `run_id, agent_id, task_description, parent_message_id?` | `TeamTask` |
| `update_team_task` | `task_id, status?, request_id?, result_summary?, finished_at?` | `TeamTask` |
| `get_team_tasks` | `run_id` | `Vec<TeamTask>` |

### Orchestration

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `execute_delegation` | `conversation_id, run_id, agent_ids[], task, context?` | `Vec<String>` (task IDs) |
| `handle_team_report` | `run_id, task_id, summary, details?` | `bool` (all done) |
| `abort_team_run` | `run_id` | `()` |

---

## 8. 프론트엔드

### 8.1 Stores

| Store | 파일 | 역할 |
|-------|------|------|
| `useTeamStore` | `src/stores/teamStore.ts` | Team CRUD + 에디터 상태 관리 |
| `useTeamRunStore` | `src/stores/teamRunStore.ts` | 활성 run/task 상태 추적, Tauri 이벤트 리스너 |
| `useTeamChatFlowStore` | `src/stores/teamChatFlowStore.ts` | 팀 대화 흐름 오케스트레이션 (delegate/report/synthesis 전체 흐름) |

**teamStore 주요 상태:**
- `teams[]`, `selectedTeamId`, `isTeamEditorOpen`, `editingTeamId`
- 액션: `loadTeams`, `createTeam`, `updateTeam`, `deleteTeam`, `addMember`, `removeMember`, `getTeamDetail`

**teamRunStore 주요 상태:**
- `activeRuns: Record<runId, TeamRun>`
- `tasksByRun: Record<runId, TeamTask[]>`
- 액션: `addRun`, `updateRunStatus`, `removeRun`, `addTask`, `updateTaskStatus`, `setupListeners`

**teamChatFlowStore:**
- `teamChatFlowStore`는 팀 대화의 전체 흐름을 관리한다
- 리더 메시지 전송 → delegate 도구 감지 → `execute_delegation` 호출 → 멤버 스트림 관찰 → report 수신 → synthesis 완료까지의 파이프라인
- `team-all-reports-in`, `team-leader-synthesis-done`, `team-run-cancelled` 이벤트를 리슨

### 8.2 Components

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| `TeamPanel` | `src/components/team/TeamPanel.tsx` | 팀 목록 사이드바 |
| `TeamEditor` | `src/components/team/TeamEditor.tsx` | 팀 생성/편집 다이얼로그 |
| `TeamChatWindow` | `src/components/team/TeamChatWindow.tsx` | 팀 대화 메인 뷰 |
| `TeamChatInput` | `src/components/team/TeamChatInput.tsx` | 팀 대화 입력 UI |
| `TeamStatusBar` | `src/components/team/TeamStatusBar.tsx` | 현재 run 상태/진행률 표시 |

### 8.3 Team 생성 시 자동 동작

`create_team_impl()` 호출 시:
1. `teams` 테이블에 레코드 삽입
2. `leader_agent_id`를 role='leader'로 `team_members`에 자동 추가
3. `member_agent_ids`가 있으면 각각 role='member'로 추가 (리더 중복 시 skip)
