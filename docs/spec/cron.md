# Cron System

> 에이전트별 예약 작업 실행 시스템. 3가지 스케줄 타입을 지원하며, 백그라운드 루프에서 due job을 claim하여 LLM + tool loop로 실행한다.

---

## 1. DB Schema

### 1.1 cron_jobs

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
    claimed_at      TEXT,                     -- 중복 실행 방지용 락
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_cron_jobs_agent    ON cron_jobs(agent_id);
CREATE INDEX idx_cron_jobs_enabled  ON cron_jobs(enabled);
CREATE INDEX idx_cron_jobs_next_run ON cron_jobs(next_run_at);
```

### 1.2 cron_runs

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
CREATE INDEX idx_cron_runs_job ON cron_runs(job_id);
```

---

## 2. Schedule Types

### 2.1 `at` (1회 실행)

- **형식:** ISO 8601 / RFC 3339 타임스탬프 (예: `2026-03-30T09:00:00+09:00`)
- **검증:** `chrono::DateTime::parse_from_rfc3339()`
- **next_run_at:** schedule_value 그대로 사용
- **실행 후:** `enabled = false`, `next_run_at = NULL` (자동 비활성화)

### 2.2 `every` (반복 간격)

- **형식:** 초 단위 정수 문자열 (예: `3600` = 1시간)
- **검증:** `u64::parse()`, **최소 60초**
- **next_run_at:** `from_time + Duration::seconds(value)`
- **실행 후:** 현재 시각 기준으로 다음 next_run_at 재계산

### 2.3 `cron` (크론 표현식)

- **형식:** 5-field cron 표현식 (예: `0 9 * * 1-5` = 평일 오전 9시)
- **내부 변환:** `"0 {schedule_value}"` (초 필드를 0으로 고정하여 6-field로 변환)
- **검증:** `cron::Schedule::from_str()`
- **next_run_at:** 로컬 타임존 기준으로 다음 실행 시각 계산 후 UTC 변환
- **실행 후:** 현재 시각 기준으로 다음 next_run_at 재계산

### 2.4 검증 시점

- `create_cron_job_impl()` 호출 시
- `update_cron_job_impl()`에서 schedule_type 또는 schedule_value가 변경된 경우

---

## 3. CronScheduler 백그라운드 루프

`CronScheduler`는 앱 시작 시 `app.manage()`로 등록되고, `CronScheduler::run(app)` 비동기 함수가 tokio task로 실행된다.

### 3.1 구조

```rust
pub struct CronScheduler {
    notify: Arc<Notify>,        // 외부에서 깨울 수 있는 알림
    enabled: AtomicBool,        // 스케줄러 활성 여부
}
```

- `notify_change()`: job 생성/수정/삭제 시 호출하여 스케줄러를 즉시 깨움
- `set_enabled(bool)`: 스케줄러 비활성화/활성화
- `is_enabled()`: 현재 상태 확인

### 3.2 시작 단계

```
1. reset_stale_claims(threshold: 30분)
   - claimed_at이 30분 이상 경과한 job의 claimed_at을 NULL로 리셋
   - 해당 job의 running cron_run을 failed로 전환 (crash recovery)

2. coalesce_misfires()
   - 앱 오프라인 동안 놓친 due job을 1회만 실행
   - claim_due_jobs_impl(now)로 과거 due job 수집 → tokio::spawn 실행
```

### 3.3 메인 루프

```
loop {
    if !enabled → notify.notified().await (대기)

    1. claim_due_jobs_impl(now):
       - enabled=1, next_run_at <= now, claimed_at IS NULL 인 job 조회
       - 각 job에 claimed_at 설정 (원자적 락)
       - cron_run 레코드 생성 (status: running)
       - (job, run) 쌍 반환

    2. 각 (job, run) → tokio::spawn(execute_cron_job())

    3. compute_sleep_duration():
       - get_min_next_run_at() → 가장 빠른 next_run_at 조회
       - 없으면 기본 60초 sleep
       - 이미 과거면 100ms 후 즉시 재확인

    4. tokio::select! {
         sleep(duration) => {}       // 다음 due까지 대기
         notify.notified() => {}     // 외부 알림으로 즉시 깨어남
       }
}
```

### 3.4 execute_cron_job 상세

```
execute_cron_job(app, job, run):
  1. cron:job-started 이벤트 emit

  2. ExecutionScope 구성:
     - actor_agent_id: job.agent_id
     - role: CronExecution
     - trigger: BackendTriggered

  3. actor_context::resolve()로 persona/tools/memory 해석

  4. build_system_prompt() + job.prompt으로 LLM 요청 구성

  5. credential 스크러빙

  6. Tool loop (최대 10회 반복):
     a. do_completion() → ChatCompletionResponse
     b. thinking 에러 시 자동 폴백 (thinking 제거 후 재시도)
     c. tool_calls 없으면 → response.content를 result_summary로 저장, 종료
     d. tool_calls 있으면:
        - assistant 메시지(tool_calls 포함)를 대화에 추가
        - 각 tool call 실행 (execute_tool_inner_public, auto-approved)
        - tool 결과 메시지 추가
        - thinking 제거 후 다음 반복

  7. finish_run():
     - cron_run 업데이트 (status, result_summary, error, finished_at)
     - cron_job 업데이트:
       - last_run_at, last_result, last_error, run_count+1
       - claimed_at → NULL (락 해제)
       - at 타입: enabled → false, next_run_at → NULL
       - every/cron 타입: next_run_at 재계산
     - cron:job-completed 또는 cron:job-failed 이벤트 emit
```

---

## 4. Misfire Coalesce 로직

앱이 오프라인 상태일 때 놓친 job들을 처리하는 전략:

1. **시작 시 1회만 실행:** 놓친 횟수와 무관하게 due인 job을 한 번만 실행
2. **claim_due_jobs_impl(now)** 호출로 과거 due인 모든 job을 가져옴
3. 각 job을 `tokio::spawn`으로 실행
4. 실행 완료 후 `next_run_at`이 현재 시각 기준으로 재계산되므로, 오래된 next_run_at이 계속 남는 문제가 발생하지 않음

---

## 5. CronExecution Role의 도구 제한

`ExecutionRole::CronExecution`일 때의 특성:

- `resolve()` → `resolve_with_settings()`에서 `TOOL_CONFIG.json`의 `permission_tier`에 따라 도구 필터링
- `role_instruction(CronExecution)` 전용 지시문이 시스템 프롬프트에 추가
- 도구 호출은 자동 승인 (사용자 확인 없음)
- `thinking` 에러 시 자동 폴백 후 재시도
- tool loop 최대 10회 반복

---

## 6. Tauri 이벤트

| 이벤트명 | 페이로드 | 발생 시점 |
|----------|---------|----------|
| `cron:job-started` | `{ job_id, run_id, agent_id }` | job 실행 시작 |
| `cron:job-completed` | `{ job_id, run_id, success: true, result_summary }` | job 정상 완료 |
| `cron:job-failed` | `{ job_id, run_id, success: false, error }` | job 실패 |

---

## 7. Tauri 커맨드 목록

### Job CRUD

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `create_cron_job` | `CreateCronJobRequest { agent_id, name, description?, schedule_type, schedule_value, prompt, enabled? }` | `CronJob` |
| `list_cron_jobs` | (없음) | `Vec<CronJob>` |
| `list_cron_jobs_for_agent` | `agent_id: String` | `Vec<CronJob>` |
| `get_cron_job` | `id: String` | `CronJob` |
| `update_cron_job` | `id, UpdateCronJobRequest { name?, description?, schedule_type?, schedule_value?, prompt?, enabled? }` | `CronJob` |
| `delete_cron_job` | `id: String` | `()` |
| `toggle_cron_job` | `id: String, enabled: bool` | `CronJob` |

### Run 조회

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `list_cron_runs` | `job_id: String, limit?: i64` | `Vec<CronRun>` |

**참고:** `list_cron_runs`의 기본 limit은 50이며, 최신순(started_at DESC) 정렬.

### 커맨드-스케줄러 연동

모든 CRUD 커맨드(`create_cron_job`, `update_cron_job`, `delete_cron_job`, `toggle_cron_job`)는 DB 조작 후 `scheduler.notify_change()`를 호출하여 스케줄러를 즉시 깨운다. 이로써 새 job이나 변경된 스케줄이 다음 sleep 주기까지 기다리지 않고 바로 반영된다.

---

## 8. 프론트엔드

### 8.1 Store

| Store | 파일 | 역할 |
|-------|------|------|
| `useCronStore` | `src/stores/cronStore.ts` | Job CRUD + 에디터 상태 + run 히스토리 + 이벤트 리스너 |

**주요 상태:**
- `jobs[]`, `selectedJobId`, `isEditorOpen`, `editingJobId`, `runs[]`

**주요 액션:**
- `loadJobs()`, `loadJobsForAgent(agentId)` -- job 목록 로드
- `createJob(request)`, `updateJob(id, request)`, `deleteJob(id)`, `toggleJob(id, enabled)` -- CRUD
- `selectJob(id)`, `openEditor(jobId?)`, `closeEditor()` -- UI 상태
- `loadRuns(jobId)` -- run 히스토리 로드
- `setupListeners()` -- `cron:job-started`, `cron:job-completed`, `cron:job-failed` 이벤트 리스너 등록

### 8.2 Components

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| `CronPanel` | `src/components/cron/CronPanel.tsx` | Job 목록 + 상태 표시 + 실행 기록 |
| `CronEditor` | `src/components/cron/CronEditor.tsx` | Job 생성/편집 폼 (스케줄 타입 선택, cron 표현식 입력 등) |

---

## 9. next_run_at 계산 (compute_next_run_at)

```rust
fn compute_next_run_at(
    schedule_type: &CronScheduleType,
    schedule_value: &str,
    from_time: DateTime<Utc>,
) -> Option<String>
```

| 타입 | 계산 |
|------|------|
| `at` | `schedule_value` 그대로 반환 |
| `every` | `from_time + Duration::seconds(value)` |
| `cron` | 로컬 타임존으로 변환 → `schedule.after(local_now).next()` → UTC 변환 |

**호출 시점:**
- job 생성 시 (enabled=true인 경우)
- job 업데이트 시 (schedule 또는 enabled 변경 시)
- toggle 시 (enabled → true 전환 시)
- job 실행 완료 후 (`complete_cron_run_impl` 내)
