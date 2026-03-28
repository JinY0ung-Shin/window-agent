# Codebase Refactoring Plan

> 조사일: 2026-03-28
> 검증일: 2026-03-28 (Opus 직접 확인, 3차 검증 완료)
> 코드베이스 규모: ~57,000 LOC (프론트엔드 27.6K + 백엔드 28.4K + 사이드카 0.9K)

---

## HIGH - 우선 해결 필요

### 1. ~~relay/manager/mod.rs — 986줄, 테스트 0줄~~ ✅ 완료

> **완료일: 2026-03-28** — 5개 파일로 분할, cargo check 0 경고, 전체 테스트 통과

| 파일 | 줄 수 | 역할 |
|------|-------|------|
| `mod.rs` | 79 | 타입 정의, 구조체, 생성자 |
| `peers.rs` | 111 | 피어 관리, 키 등록, 상태 조회 |
| `lifecycle.rs` | 109 | 시작/중지, 디렉토리 등록 |
| `messaging.rs` | 351 | 암호화, 메시지 전송, 친구 요청, 아웃박스 |
| `event_loop.rs` | 374 | 이벤트 루프, 수신 봉투 처리, Introduce 핸들링 |

### 2. ~~chatFlowBase.ts — 834줄, 12개 모듈 의존~~ ✅ 완료

> **완료일: 2026-03-28** — 3개 파일로 분할, tsc 0 에러, 616개 테스트 전체 통과

| 파일 | 줄 수 | 역할 |
|------|-------|------|
| `chatFlowCore.ts` | 358 | 에이전트/설정 해석, 토큰 추정, 대화 생성 |
| `streamResponses.ts` | 250 | 스트림 턴 실행, 메시지 저장, 에러 처리 |
| `toolExecution.ts` | 255 | 도구 루프, 도구 호출 처리, 파싱 |

`chatFlowBase.ts` 삭제됨. 소비자 2개(`chatFlowStore.ts`, `teamChatFlowStore.ts`) import 경로 갱신 완료.

---

## MEDIUM - 감시 항목 (코드 변경 불필요)

### 3. 프론트/백 타입 수동 동기화

`types.ts` (368줄)에 "match Rust structs" 주석으로 수동 관리 중.
직접 비교 결과 필드가 정확히 일치하며 현재 리스크는 낮음.
타입 변경이 잦아지면 `ts-rs` 도입 검토.

### 4. Zustand 스토어 플랫 구조 (24개 파일)

리팩토링 후 24개 파일이 `src/stores/`에 평탄하게 나열. 현재는 관리 가능.
`conversationStore`가 9개 스토어 import — 오케스트레이션 레이어라 자연스러운 면 있음.

**권장 조치:** 스토어 수가 30개 이상으로 증가 시 도메인별 하위 디렉토리 그룹화 검토

---

## LOW - 마이너 이슈 (코스메틱 / 점진적 개선)

### 5. `agent_commands.rs` OLD_* 상수 125줄

> 3차 검증 결과: `seed_manager_agent`는 87줄(합리적). "338줄 단일 함수"는 오류 — 함수+상수+헬퍼 합산치였음.

v1 레거시 프롬프트 상수(`OLD_IDENTITY_MD`, `OLD_SOUL_MD`, `OLD_AGENTS_MD`)가 ~125줄 차지.
기능에 영향 없는 코스메틱 이슈. 리소스 파일로 분리 가능하나 우선순위 낮음.

### 6. `relay_commands` 큰 함수 2개

> 3차 검증 결과: 절차적 워크플로우 함수로 단계별 주석 완비, 분기 복잡도 낮음. 분할 가치 낮음.

- `relay_accept_invite` — 132줄 (초대 파싱 → 연락처 생성 → 키 등록 → Introduce 전송)
- `relay_send_message` — 122줄 (메시지 생성 → 암호화 → 전송 → 아웃박스)

각 단계 5-15줄로 간결하고 주석이 잘 달려 있음. 한 번만 호출되는 소함수로 분할 시 오히려 가독성 저하.

### 7. 에러 타입 내부 불일관

`browser/commands.rs`의 `Result<_, String>`은 Tauri command가 아닌 `BrowserManager` 내부 메서드.
**Tauri 경계에서 String이 노출되는 경우는 0건.** 실질적 동작 문제 없음.

내부 함수의 `Result<T, String>` 28개 파일 존재하나, `From<String> for AppError` 구현으로 자동 변환됨.

### 8. `parse_frontmatter` 2개 구현

- `vault/note.rs`: `Frontmatter` 구조체, 에러 시 `Result::Err` 반환
- `skill_service.rs`: `SkillFrontmatter` 구조체, 에러 시 fallback + diagnostics 반환

다른 구조체, 다른 에러 전략. "YAML delimiter 분리" 10줄 정도만 공유 가능. 통합 가치 낮음.

### 9. 빈 디렉토리

- `src/components/memory/` — 컴포넌트 없이 폴더만 존재
- `docs/design/` — 빈 플레이스홀더

### 10. 테스트 헬퍼 중복

- `create_test_agent()`가 `cron_scheduler.rs`와 `team_orchestrator.rs`에 각각 동일 구현

### 11. Trivial wrapper 함수

- `agent_commands.rs`의 `validate_folder_name()`, `validate_agent_file_inputs()` — 각 1회 사용, 인라인 가능

### 12. 네이밍 약어 불일관

- `db_ref`/`db`, `pid`/`peer_id`, `fm`/`frontmatter` 혼용

### 13. Settings 패널 과도 파편화

- 26~90줄짜리 초소형 패널 8개, 반복 폼 패턴 미추출
- 그러나 각 패널의 관심사가 다르므로 분리 자체는 합리적.

### 14. 테스트 파일 import 경로

- `__tests__/` 테스트가 `../../../stores`, 부모 컴포넌트는 `../../stores`
- tsconfig path alias 도입 시 자연 해소.

### 15. 모듈 가시성 불일관 (Rust)

- `browser/mod.rs`: private/`pub(crate)` 비대칭, `relay/db/mod.rs`: `pub use *` 재내보내기
- 직접 확인 결과: 모두 모듈 내부에서만 사용됨. 동작 문제 없음.

---

## 구조적 강점 (유지할 부분)

- **Commands 모듈** — 12개 도메인별 파일로 잘 분리됨
- **wa-shared 크레이트** — 릴레이 프로토콜 타입의 단일 진실 소스 역할
- **Tauri 커맨드 등록** — `lib.rs`에 81개 커맨드 명시적 나열
- **테스트 배치** — 컴포넌트 옆 `__tests__/` 패턴 일관 적용
- **서비스 레이어** — 관심사별 분리 양호
- **conversation_ops.rs** — 로직 182줄에 테스트 768줄, 모범적 테스트 커버리지
- **에러 시스템** — AppError 10개 variant + 4개 From impl, Tauri 경계에서 일관 사용 (0건 누수)
- **브라우저 사이드카** — 독립 런타임으로 잘 격리됨
- **타입 동기화** — 수동 관리이나 현재 필드 정확히 일치
- **relay_commands 워크플로우** — 큰 함수 2개지만 단계별 주석 완비, 가독성 양호
- **seed_manager_agent** — 87줄로 합리적 크기, 리소스 로딩 패턴 깔끔

---

## 요약

- **HIGH 2건**: 모두 완료 ✅
- **MEDIUM 2건**: 감시 항목 (타입 동기화, 스토어 구조) — 성장 시 대응
- **LOW 11건**: 코스메틱 이슈, 점진적 개선 대상
- **코드 변경이 필요한 리팩토링은 모두 완료됨**
