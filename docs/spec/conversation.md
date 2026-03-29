# Conversation System

대화 시스템, LLM 파이프라인, 스트리밍, 도구 실행 루프, 라이프사이클을 포괄하는 통합 문서.

---

## 1. LLM 호출 흐름

### 1.1 스트리밍 (프론트엔드)

```
chat_completion_stream(request) -> Tauri 커맨드 호출
  -> request_id 즉시 반환
  -> tokio task 생성 + RunRegistry에 AbortHandle 등록
  -> SSE 스트림 시작 (POST /chat/completions, stream: true)
  -> 청크별 "chat-stream-chunk" Tauri 이벤트 발행
  -> 완료 시 "chat-stream-done" Tauri 이벤트 발행
```

### 1.2 비스트리밍 (백엔드 tool loop)

```
do_completion(client, api_key, base_url, body) -> ChatCompletionResponse
  - thinking 에러 시 자동 폴백 (thinking 제거 후 재시도)
  - tool_calls 있으면 실행 후 재호출 (max 10 iterations)
```

백엔드 비스트리밍은 다음 경로에서 사용:
- CronExecution (cron_scheduler)
- RelayResponse (secretary 자동응답)
- TeamMember 실행 (team_orchestrator)

---

## 2. Streaming Protocol

### 2.1 스트림 시작

```
chat_completion_stream(request)
  -> request_id: UUID 생성
  -> tokio::spawn 으로 비동기 task 시작
  -> RunRegistry에 AbortHandle 등록
  -> SSE 연결 (POST, stream: true, Accept: text/event-stream)
```

### 2.2 이벤트 포맷

**chat-stream-chunk:**

```typescript
{
  request_id: string;
  delta: string;              // content 텍스트 조각
  reasoning_delta?: string;   // thinking 텍스트 조각
  tool_calls_delta?: [{       // tool_call 인덱스별 조각
    index: number;
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }];
}
```

**chat-stream-done:**

```typescript
{
  request_id: string;
  full_content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];     // 완성된 tool_call 배열
  error?: string;              // 에러 메시지 (있으면 실패)
}
```

### 2.3 중단 (Abort)

```
abort_stream(request_id)
  -> RunRegistry에서 AbortHandle 조회
  -> AbortHandle.abort() 호출
  -> tokio task 즉시 중단
  -> "chat-stream-done" 이벤트 발행 (error: "aborted")
```

### 2.4 Thinking 폴백

1. `thinking_enabled=true`로 스트림 시작
2. HTTP 400/422 + "thinking" 키워드 감지 시 -> thinking 파라미터 제거 후 재시도
3. 성공한 첫 tool loop 이후에도 thinking 제거 (안정성, 일부 모델 호환)

---

## 3. Frontend Chat Flow

### 3.1 메시지 전송 흐름 (도구 반복 루프)

```
사용자 메시지 입력
  -> ensureConversation()
     (대화 없으면 생성, agent_id 바인딩, 제목 자동 설정)
  -> BOOT.md 로드 (새 대화 첫 메시지만)
  -> 첨부파일 저장 (saveChatImage -> 디스크 경로)
  -> saveMessage(role: "user", content, attachments?)

  -> runToolLoop():
      Iteration 0..MAX_TOOL_ITERATIONS (10):

        streamOneTurn():
          -> pre-compaction 체크 (estimateContextTokens)
             모델별 컨텍스트 한도의 80% 초과 시 preCompactFlush
          -> buildConversationContext()
             messages + summary + memory + vault notes + skills + boot
          -> chatCompletionStream() -> 청크 수신

        tool_calls 없음?
          -> saveFinalResponse() -> 종료 (루프 탈출)

        tool_calls 있음?
          -> saveAssistantToolCallMessage() (도구 호출 메시지 DB 저장)
          -> classifyToolCalls() (auto/confirm/deny 분류)
          -> denied: "Tool denied" 메시지 저장
          -> confirm: waitForToolApproval() (사용자 대기 -- UI 표시)
          -> auto + approved: executeToolCalls() -> 결과 DB 저장
          -> refreshStores (vault/persona 변경 감지 -> UI 갱신)
          -> 다음 iteration (새 request_id + msg_id 생성)

      MAX_TOOL_ITERATIONS 초과:
          -> "Maximum tool iterations reached" 메시지 -> 종료
```

### 3.2 MAX_TOOL_ITERATIONS

상수값: **10**. 한 번의 사용자 메시지에 대해 최대 10회의 도구 호출-응답 사이클이 허용된다.

---

## 4. Tool Execution

### 4.1 Backend dispatcher

```
execute_tool(tool_name, tool_input, conversation_id)
  -> tool_call_log 생성 (status: pending)
  -> timeout 설정:
     - browser_* 도구: 360초
     - run_shell: 310초
     - 기타: 30초
  -> dispatcher 라우팅:
     - shell_tools: run_shell
     - file_tools: read_file, write_file, delete_file, list_directory
     - browser_tools: browser_navigate, browser_snapshot, browser_click,
                      browser_type, browser_wait, browser_back, browser_close
     - self_tools: self_inspect, manage_schedule
     - web_tools: web_search
     - team_tools: delegate, report
  -> 결과 파싱 + artifact_id 추출 (browser 도구의 경우)
  -> tool_call_log 업데이트 (status: executed | error, duration_ms)
```

### 4.2 Timeout 정책

| 도구 카테고리 | Timeout | 사유 |
|-------------|---------|------|
| browser_* | 360s | 페이지 로딩, 네트워크 대기 |
| run_shell | 310s | 장시간 명령 실행 |
| 기타 | 30s | 파일 I/O, API 호출 |

---

## 5. Tool Classification

### 5.1 분류 로직

`classifyToolCalls(parsedToolCalls, toolDefinitions, options)` 함수가 각 도구 호출을 세 카테고리로 분류한다:

```
for each tool_call:
  tier = getToolTier(toolDefinitions, tool_call.name)

  if tier == "deny":
    -> denyTools

  if tier == "confirm":
    1. workspace path 일치? -> auto (workspace write 자동 승인)
    2. browser 도구 + 이미 승인된 도메인? -> auto
    3. autoApproveEnabled + credential 미관련? -> auto
    4. 그 외 -> confirm

  if tier == "auto":
    -> autoTools
```

### 5.2 자동 승인 조건 (confirm-tier 도구가 auto로 승격되는 경우)

| 조건 | 설명 |
|------|------|
| **Workspace write** | `write_file`/`delete_file`의 경로가 workspace 내부일 때 |
| **Browser domain** | `browser_navigate` 등의 URL 도메인이 해당 대화에서 이미 승인되었을 때 |
| **autoApproveEnabled** | TOOL_CONFIG.json의 `auto_approve=true` AND 도구가 credential 비관련일 때 |

### 5.3 Credential-bearing 도구 (auto_approve 제외)

`isCredentialBearingTool()` 함수로 판별:

| 도구 | 조건 | 결과 |
|------|------|------|
| `manage_schedule` | 항상 | true (NEVER_AUTO_APPROVE_TOOLS) |
| `run_shell` | `agentHasCredentials=true` | true |
| `browser_type` | text에 `{{credential:ID}}` 패턴 존재 + `agentHasCredentials=true` | true |
| 기타 | - | false |

---

## 6. Bootstrap 흐름 (새 에이전트 생성)

```
사용자가 "에이전트 설명" 입력
  -> get_bootstrap_prompt(locale) -> 부트스트랩 전용 시스템 프롬프트

  -> executeBootstrapTurn() (max 5 iterations):
      -> LLM 호출 (tools: write_file, read_file만 허용)
      -> tool_calls -> 파일 작성 (IDENTITY.md, SOUL.md, USER.md, AGENTS.md)
      -> 반복

  -> isBootstrapComplete() 확인
     (IDENTITY.md, SOUL.md, USER.md, AGENTS.md 4개 필수 파일 존재 확인)

  -> completeBootstrap()
     에이전트 DB 레코드 생성 + FS sync
```

---

## 7. Attachment 시스템

### 7.1 데이터 모델

```typescript
interface Attachment {
  type: "image";
  path: string;        // 디스크 경로 (저장 후)
  mime?: string;
  dataUrl?: string;    // In-memory data URL (UI 렌더링용, DB에 저장 안 함)
}
```

### 7.2 흐름

```
사용자 이미지 첨부
  -> pendingAttachments에 dataUrl로 임시 보관

메시지 전송 시:
  -> saveChatImage(base64)
     -> 디스크 파일 저장
     -> 디스크 경로 반환

  -> saveMessage({
       attachments: JSON.stringify([{ type: "image", path: "/disk/path.png" }])
     })

DB에서 로드 시:
  -> useAttachmentSrc(attachment)
     -> readFileBase64(path)
     -> data URL 변환 (렌더링용)
```

### 7.3 저장 위치

`messages.attachments` 컬럼에 JSON 문자열로 저장. `dataUrl`은 DB에 포함되지 않으며, 로드 시 디스크에서 재생성한다.

---

## 8. Conversation Lifecycle

### 8.1 요약/통합 흐름 (Consolidation)

메모리 통합은 재귀적 수식 `m(n+1) = F(m(n), d(n))`을 따른다:

```
세션 종료 시 (다른 대화로 전환 또는 앱 종료)
  -> triggerConsolidation() 호출:

  [Step 1] generateDigest():
    최근 30개 메시지 + vault 노트 (이 대화에서 생성된 것만) + 파일 활동 수집
    -> LLM(model, temperature=0)으로 digest 생성
    -> writeDigest(agentId, conversationId, digestContent)
    -> archiveConversationNotes(conversationId, agentId)

  [Step 2] consolidateMemory():
    기존 consolidated memory + 새 digest -> LLM으로 병합
    -> writeConsolidatedMemory(agentId, content, version: N+1)
    -> 스냅샷 저장: snapshots/v{N+1}_{timestamp}.md
    -> updateConversationConsolidated(conversationId) -- consolidated_at 기록
```

### 8.2 메모리 파일 구조

```
{app_data_dir}/memory/{agent_id}/
  consolidated.md              -- 현재 누적 메모리
  snapshots/v{N}_{timestamp}.md -- 버전별 스냅샷
  digests/{conversation_id}.md -- 대화별 요약
```

### 8.3 Per-agent Mutex

동일 에이전트에 대한 동시 consolidation을 방지한다. `activeJobs: Set<agentId>`로 관리. 이미 실행 중이면 no-op.

### 8.4 Crash Recovery

```
앱 시작 시 (initService.ts Step 10):
  -> initConsolidationRecovery()
     -> listPendingConsolidations()
        (digest_id 없거나 consolidated_at 없는 대화 목록)
     -> 각 대화에 대해 consolidateConversation() 비동기 실행
```

두 가지 복구 케이스:
1. **digest 미생성** -- Step 1부터 다시 실행
2. **digest 생성 완료 + consolidation 미완료** -- Step 2만 실행

### 8.5 Consolidation 건너뛰기 조건

- 에이전트에 대해 이미 consolidation 진행 중 (per-agent mutex)
- 대화의 메시지가 3개 미만
- `consolidated_at`이 이미 설정됨 (이미 완료)

---

## 9. Pre-compaction

### 9.1 개요

대화 중 컨텍스트 윈도우가 모델 한도에 가까워지면, 중간 통합을 실행하여 메모리를 갱신한다.

### 9.2 트리거 조건

```
estimateContextTokens(messages + system_prompt + memory + notes)
  / getContextLimit(modelName)
  >= COMPACTION_THRESHOLD (0.80)
```

### 9.3 모델별 컨텍스트 한도

| 모델 패턴 | 한도 (tokens) |
|-----------|-------------|
| gpt-5.3-codex | 1,000,000 |
| gpt-4.1, gpt-4.1-mini, gpt-4.1-nano | 1,047,576 |
| gpt-4o, gpt-4o-mini | 128,000 |
| claude-sonnet-4-5, claude-opus-4-5, claude-haiku-3-5 | 200,000 |
| 기타 | 128,000 (기본값) |

### 9.4 동작

```
preCompactFlush(conversationId, agentId, modelName, totalTokens):
  1. flushedConversations 중복 체크 (대화당 1회만)
  2. generateDigest() -- 현재 메시지로 digest 생성
  3. lockedConsolidateMemory() -- 메모리 병합
  주의: DB 필드(digest_id, consolidated_at)는 갱신하지 않음
        -> 세션 종료 시 최종 consolidation이 전체 메시지로 다시 실행됨
```

### 9.5 실행 시점

`streamOneTurn()` 호출 전에 매 iteration마다 토큰을 추정하고, 임계값 초과 시 `preCompactFlush()`를 실행한다. 이후 `buildConversationContext()`가 갱신된 메모리를 포함하여 컨텍스트를 재구성한다.

---

## 10. Learning Mode

### 10.1 활성화

대화별로 `conversations.learning_mode` 플래그로 관리.
`set_learning_mode(conversation_id, enabled)` 커맨드로 토글.

### 10.2 영향

Learning mode가 활성화되면:

1. **시스템 프롬프트에 추가 지시:**
   - "Learning Mode" 행동 규칙 (Confirm, Connect, Ask, 최대 3개 메모리/턴, 기존 메모리 참조)
2. **Vault 가이드 포함:**
   - `write_file` 활성이면 Vault 사용 가이드가 시스템 프롬프트에 추가됨
3. **Consolidation에 반영:**
   - 학습 내용이 vault 노트로 저장되고, consolidation 시 digest에 포함됨
