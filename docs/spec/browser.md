# Browser Automation Specification

> Window Agent의 브라우저 자동화 시스템. Node.js + Playwright 기반 사이드카 프로세스를 통해 Chromium 브라우저를 제어한다.

---

## 1. Architecture

```
Tauri (Rust)                  Sidecar (Node.js)              Browser (Chromium)
 BrowserManager  ──HTTP──>  server.js (Playwright)  ──CDP──>  Page contexts
   |                           |
   |  ensure_sidecar()         |  sessions Map
   |  send_command()           |  handlers{}
   |                           |
   └─ sessions HashMap         └─ http.createServer()
      (per conversation)          127.0.0.1:<dynamic port>
```

### 핵심 설계 원칙
- **프로세스 격리**: 브라우저 작업은 별도 Node.js 프로세스에서 실행 (Tauri 메인 프로세스 안정성 보장)
- **대화별 세션**: 각 conversation_id마다 독립적인 BrowserContext + Page
- **보안 우선**: 모든 URL은 보안 정책을 통과해야 탐색 가능
- **Lazy 시작**: sidecar는 첫 브라우저 명령 시 자동 시작

---

## 2. BrowserManager (Rust)

`src-tauri/src/browser/mod.rs`에 정의된 핵심 관리 구조체.

```rust
pub struct BrowserManager {
    sessions:           Arc<RwLock<HashMap<String, BrowserSession>>>,
    sidecar:            Arc<Mutex<Option<SidecarProcess>>>,
    pending_approvals:  Arc<Mutex<HashMap<String, HashSet<String>>>>,
    idle_task:          Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    proxy_server:       Arc<Mutex<String>>,
    no_proxy:           Arc<Mutex<String>>,
    headless:           Arc<Mutex<bool>>,
    app_data_dir:       PathBuf,
    app_handle:         Option<tauri::AppHandle>,
    client:             reqwest::Client,
}
```

| 필드 | 용도 |
|------|------|
| `sessions` | conversation_id -> BrowserSession 매핑. RwLock으로 동시 읽기 허용 |
| `sidecar` | 현재 실행 중인 SidecarProcess (child + port) |
| `pending_approvals` | 세션 생성 전에 도착한 도메인 승인을 임시 보관 |
| `idle_task` | idle cleanup 백그라운드 태스크 핸들 |
| `proxy_server` | 프록시 서버 URL (예: `http://proxy:8080`). 빈 문자열이면 시스템 기본 |
| `no_proxy` | 프록시 바이패스 도메인 목록 (쉼표 구분) |
| `headless` | headless 모드 여부 |
| `app_data_dir` | 스크린샷 저장 경로의 기준 디렉토리 |
| `app_handle` | Tauri AppHandle (이벤트 방출, 설정 저장용) |
| `client` | reqwest::Client (no_proxy 설정, sidecar HTTP 통신용) |

### 초기화 (`BrowserManager::new`)

1. `browser_screenshots` 디렉토리 생성
2. AppSettings에서 proxy/no_proxy/headless 읽기
3. 설정이 비어있으면 시스템 프록시 자동 감지 (`detect_system_proxy`, `detect_system_no_proxy`)
4. reqwest::Client 빌드 (`.no_proxy()` -- sidecar가 localhost이므로 프록시 무시)

---

## 3. BrowserSession

`src-tauri/src/browser/mod.rs`

```rust
pub struct BrowserSession {
    pub session_id:      String,
    pub last_url:        String,
    pub last_title:      String,
    pub last_ref_map:    HashMap<u32, ElementRef>,
    pub last_active:     DateTime<Utc>,
    pub security_policy: SessionSecurityPolicy,
}
```

| 필드 | 용도 |
|------|------|
| `session_id` | sidecar측 세션 식별자 (예: `session_a1b2c3d4e5f6`) |
| `last_url` | 마지막으로 확인된 페이지 URL |
| `last_title` | 마지막 페이지 제목 |
| `last_ref_map` | 현재 스냅샷의 element ref 번호 -> ElementRef 매핑 |
| `last_active` | 마지막 활동 시각 (idle cleanup 기준) |
| `security_policy` | 이 세션의 보안 정책 (승인된 도메인, 차단 목록) |

### 세션 라이프사이클 (`session.rs`)

| 메서드 | 설명 |
|--------|------|
| `get_or_create_session(conversation_id)` | 기존 세션 반환 또는 새로 생성. 생성 시 pending_approvals 적용 |
| `close_session(conversation_id)` | 세션 제거 + sidecar에 close_session 명령 |
| `approve_domain(conversation_id, domain)` | 세션 존재 시 즉시 적용, 없으면 pending에 보관 |
| `update_session_from_response(conversation_id, resp)` | sidecar 응답으로 url/title/ref_map 갱신 + 보안 검증 |

---

## 4. ElementRef

```rust
pub struct ElementRef {
    pub selector:    String,    // Playwright 선택자 (예: role=textbox[name="Search"])
    pub role:        String,    // ARIA role (예: button, link, textbox)
    pub name:        String,    // 접근성 이름
    pub tag:         String,    // HTML 태그명
    pub is_password: bool,      // 비밀번호 필드 여부 (default: false)
}
```

- `is_password`는 sidecar에서 `isPassword` (camelCase)로도 수신 가능 (`#[serde(alias)]`)
- 비밀번호 필드에 `browser_type`으로 직접 입력 시도 시 차단 (credential placeholder 사용 필수)

---

## 5. Sidecar 프로세스 (`sidecar.rs`)

### 5.1 SidecarProcess

```rust
struct SidecarProcess {
    child: Child,   // std::process::Child (프로세스 수명 관리)
    port: u16,      // 동적 할당된 HTTP 포트
}
```

### 5.2 시작 흐름 (`ensure_sidecar`)

```
1. Mutex 잠금 → 기존 sidecar 존재?
   ├─ Yes → /health 헬스체크
   │   ├─ 성공 → 포트 반환
   │   └─ 실패 → sidecar = None (재시작)
   └─ No → 새로 시작

2. 경로 해석
   a. server.js: Tauri 리소스 → CWD 폴백 (dev)
   b. node.exe: Tauri 리소스 번들 → system PATH 폴백
   c. browsers_path: 번들 Chromium → app_data_dir/playwright-browsers 폴백

3. 환경변수 설정
   - PLAYWRIGHT_BROWSERS_PATH (번들/다운로드 Chromium)
   - PLAYWRIGHT_BROWSERS_PATH_FALLBACK (런타임 다운로드 경로)
   - BROWSER_PROXY_SERVER
   - BROWSER_NO_PROXY
   - BROWSER_HEADLESS (1/0)

4. 프로세스 시작 (Command::new(node).arg(server.js))
   - Windows: CREATE_NO_WINDOW 플래그
   - stdout 파싱:
     - CHROMIUM_INSTALL_START → 이벤트 방출
     - CHROMIUM_INSTALL_DONE → 이벤트 방출
     - CHROMIUM_INSTALL_FAILED=reason → 에러 반환
     - SIDECAR_PORT=<port> → 포트 캡처

5. 헬스체크 (최대 10회, 200ms 간격)
   - GET http://127.0.0.1:<port>/health
   - 성공 → SidecarProcess 저장 + 포트 반환
```

### 5.3 Windows 경로 처리

`strip_unc_prefix`: Windows 확장 경로 접두사 (`\\?\`)를 제거. Node.js는 이 형식의 경로를 처리할 수 없어 EISDIR 에러가 발생.

### 5.4 시스템 프록시 감지

| 함수 | 동작 |
|------|------|
| `detect_system_proxy()` | `HTTPS_PROXY`/`HTTP_PROXY` 환경변수 확인. Windows에서는 레지스트리 `ProxyServer` + `ProxyEnable` 확인 |
| `detect_system_no_proxy()` | `NO_PROXY`/`no_proxy` 환경변수 확인. Windows에서는 레지스트리 `ProxyOverride` (세미콜론 -> 쉼표 변환) |

### 5.5 종료 (`shutdown`)

```
1. idle cleanup 태스크 abort
2. 모든 세션 close_session
3. sidecar에 close 명령 (5초 타임아웃)
4. child.kill() (안전망)
```

### 5.6 설정 변경 시 sidecar 재시작

`set_headless`, `set_proxy_server`, `set_no_proxy` 호출 시:
1. 설정값 업데이트
2. 기존 sidecar 프로세스 kill
3. 모든 캐시된 세션 clear
4. AppSettings에 persist
5. 다음 브라우저 명령 시 새 설정으로 자동 재시작

---

## 6. Sidecar HTTP API (`browser-sidecar/server.js`)

### 6.1 서버 구조

- Node.js `http.createServer`
- `127.0.0.1` 바인딩, 포트 0 (OS 자동 할당)
- 시작 시 `SIDECAR_PORT=<port>` 출력 (Rust가 파싱)

### 6.2 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/health` | 헬스체크 (`{ status: "ok" }`) |
| POST | `/execute` | 명령 실행 (`{ method, session_id, params }`) |

### 6.3 핸들러 목록

| method | 설명 | 주요 동작 |
|--------|------|-----------|
| `create_session` | 세션 생성 | `browser.newContext({ viewport: 1280x720 })` + `newPage()` |
| `navigate` | URL 탐색 | `page.goto(url, { waitUntil: 'load', timeout: 30000 })` |
| `snapshot` | 현재 페이지 스냅샷 | CDP 접근성 트리 → 텍스트 스냅샷 + ref_map |
| `click` | 요소 클릭 | `locator.click()` + 500ms 대기 + load 대기(2s) |
| `type` | 텍스트 입력 | `locator.fill(text)`. 비밀번호 필드 보호 + skipScreenshot 옵션 |
| `wait` | 대기 | `page.waitForTimeout(seconds * 1000)` (0~10초) |
| `back` | 뒤로 가기 | `page.goBack({ waitUntil: 'load', timeout: 10000 })` |
| `close_session` | 세션 종료 | `context.close()` + sessions 맵에서 삭제 |
| `close` | 전체 종료 | 모든 세션 + 브라우저 종료 |

### 6.4 SidecarResponse 구조

```rust
struct SidecarResponse {
    success:       bool,
    url:           Option<String>,
    title:         Option<String>,
    snapshot:      Option<String>,       // 텍스트 스냅샷
    ref_map:       Option<HashMap<String, ElementRef>>,
    element_count: Option<usize>,
    error:         Option<String>,
    screenshot:    Option<String>,       // base64 PNG
}
```

### 6.5 Chromium 3단계 폴백

```
1단계: Playwright 번들 Chromium (PLAYWRIGHT_BROWSERS_PATH)
  └─ 실패 →
2단계: 시스템 Chrome (channel: 'chrome')
  └─ 실패 →
3단계: 런타임 다운로드 (playwright install chromium)
  - PLAYWRIGHT_BROWSERS_PATH_FALLBACK 경로에 설치
  - 5분 타임아웃
  - stdout으로 CHROMIUM_INSTALL_START/DONE/FAILED 상태 보고
```

### 6.6 프록시 설정

```javascript
// server.js getLaunchOptions()
if (process.env.BROWSER_PROXY_SERVER) {
    opts.proxy = {
        server: process.env.BROWSER_PROXY_SERVER,
        bypass: process.env.BROWSER_NO_PROXY   // 선택적
    };
}
```

---

## 7. 스냅샷 엔진

### 7.1 접근성 트리 수집

CDP (Chrome DevTools Protocol)의 `Accessibility.getFullAXTree`를 사용하여 전체 접근성 트리를 수집하고, 평탄한 노드 리스트를 트리 구조로 변환한다 (`buildTreeFromCDP`).

### 7.2 요소 필터링

| 분류 | 포함 역할 |
|------|----------|
| Interactive | button, link, textbox, checkbox, radio, combobox, menuitem, tab, switch, searchbox, slider, spinbutton, option, menuitemcheckbox, menuitemradio, treeitem |
| Structural | heading, img, navigation, main, banner, contentinfo |

- 최대 200개 요소 (`MAX_ELEMENTS`)
- Interactive 또는 Structural 역할이면서 name 또는 value가 있는 노드만 포함

### 7.3 스냅샷 텍스트 포맷

```
[1] button "검색"
[2] textbox "이메일" value="user@example.com"
[3] link "홈으로"
[4] heading "로그인"
[5] checkbox "약관 동의" [unchecked]
```

각 ref 번호는 순차적으로 부여되며, 해당 번호로 click/type 명령에서 요소를 참조한다.

### 7.4 선택자 생성 (`buildSelector`)

```
role=textbox[name="Search"]           // 유일한 경우
role=textbox[name="Search"] >> nth=1  // 동일 role+name 중복 시
role=button >> nth=3                  // 이름 없는 경우
```

- `selectorCounts` Map으로 동일 role+name 조합의 발생 횟수를 추적하여 nth 인덱스로 중복 해소

### 7.5 비밀번호 필드 감지

```javascript
isPassword: !!(role === 'textbox' && (
    node.autocomplete === 'current-password' || node.isPassword
))
```

CDP 속성의 `autocomplete=current-password` 또는 `isPassword` 플래그로 감지.

---

## 8. 스크린샷 (`screenshot.rs`)

### 8.1 BrowserToolResult

```rust
pub struct BrowserToolResult {
    pub success:        bool,
    pub url:            String,
    pub title:          String,
    pub snapshot:       String,        // 4KB 이하로 잘린 스냅샷 (LLM 컨텍스트용)
    pub snapshot_full:  String,        // 전체 스냅샷 (artifact 저장용, LLM에 전송 안 됨)
    pub element_count:  usize,
    pub artifact_id:    String,        // UUID
    pub screenshot_path: Option<String>, // 디스크 저장 경로
}
```

### 8.2 스냅샷 잘라내기

- 4000 바이트 초과 시 UTF-8 경계에서 안전하게 잘라내기
- 잘린 경우: `"...truncated (N total elements) ---"` 접미사 추가
- `snapshot_full`은 DB artifact에 전체 저장

### 8.3 스크린샷 저장

```
{app_data_dir}/browser_screenshots/{artifact_id}.png
```

- sidecar가 `page.screenshot({ type: 'png' })` 실행 -> base64 인코딩 -> Rust에서 디코드 -> 파일 저장
- 스크린샷 실패는 non-fatal (에러 로그만 출력)
- `skip_screenshot`: credential 입력 시 시각적 노출 방지를 위해 스크린샷 생략

---

## 9. 보안 정책 (`security.rs`)

### 9.1 SessionSecurityPolicy

```rust
pub struct SessionSecurityPolicy {
    pub blocked_origins: Vec<String>,     // 커스텀 차단 도메인 목록
    pub approved_domains: HashSet<String>, // 명시적 승인된 도메인
}
```

### 9.2 URL 검증 (`validate_url`)

탐색 전과 탐색 후 (리다이렉트 검증) 모두에서 호출된다.

**차단되는 스킴:**
- `file`, `chrome`, `about`, `chrome-extension`, `devtools`, `javascript`, `data`

**차단되는 주소 (approved_domains에 없는 경우):**
- 루프백: `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`
- 사설 네트워크: `10.x.x.x`, `192.168.x.x`, `172.16~31.x.x`
- 로컬 도메인: `*.local`, `*.internal`

**커스텀 차단:**
- `blocked_origins`에 포함된 문자열이 호스트에 존재하면 차단

### 9.3 리다이렉트 보안 (`validate_response_url`)

- 사이드카 응답의 최종 URL을 검증
- `about:blank` 또는 빈 URL은 허용 (초기 빈 페이지)
- 차단된 URL로 리다이렉트된 경우 에러 반환

### 9.4 도메인 승인 흐름

```
프론트엔드 → approve_browser_domain(conversation_id, domain)
  → BrowserManager::approve_domain()
    ├─ 세션 존재: security_policy.approved_domains에 즉시 추가
    └─ 세션 미존재: pending_approvals에 보관 → 세션 생성 시 자동 적용
```

---

## 10. browser_artifacts 스키마

```sql
CREATE TABLE browser_artifacts (
    id               TEXT PRIMARY KEY,      -- UUID (BrowserToolResult.artifact_id)
    session_id       TEXT NOT NULL,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    snapshot_full    TEXT NOT NULL,          -- 전체 DOM 스냅샷 (잘리지 않은 원본)
    ref_map_json     TEXT NOT NULL,          -- element ref 매핑 JSON
    url              TEXT NOT NULL,
    title            TEXT NOT NULL,
    screenshot_path  TEXT,                   -- 스크린샷 파일 절대 경로 (nullable)
    created_at       TEXT NOT NULL
);
```

- 모든 브라우저 동작은 artifact를 생성하여 히스토리 추적 가능
- `tool_call_logs.artifact_id`로 도구 호출과 연결

---

## 11. 브라우저 도구 호출 흐름

LLM이 `tool_calls`로 브라우저 도구를 요청하면 다음 흐름으로 실행된다.

### 11.1 도구 목록 (7개)

| 도구 | Tier | Timeout | 설명 |
|------|------|---------|------|
| `browser_navigate` | confirm | 360s | URL로 이동 + 스냅샷 반환 |
| `browser_snapshot` | auto | 360s | 현재 페이지 스냅샷 |
| `browser_click` | confirm | 360s | ref 번호로 요소 클릭 |
| `browser_type` | confirm | 360s | ref 번호로 텍스트 입력 |
| `browser_wait` | auto | 360s | 대기 후 스냅샷 (max 10s) |
| `browser_back` | confirm | 360s | 뒤로 가기 |
| `browser_close` | confirm | 360s | 세션 종료 |

### 11.2 실행 흐름 (dispatcher.rs)

```
execute_tool("browser_navigate", { url: "..." }, conversation_id)
  → tool_call_log 생성 (status: pending)
  → BrowserManager.navigate(conversation_id, url)
    1. get_or_create_session(conversation_id) → session_id
    2. validate_url(url, security_policy)
    3. send_command("navigate", session_id, { url })
       → HTTP POST http://127.0.0.1:<port>/execute
       → sidecar: page.goto() + generateSnapshot() + screenshot
    4. update_session_from_response()
       → validate_response_url() (리다이렉트 검증)
       → session.last_url/title/ref_map 갱신
    5. build_tool_result()
       → 스냅샷 4KB 잘라내기
       → 스크린샷 저장
       → BrowserToolResult 반환
  → artifact_id 추출
  → browser_artifacts DB 저장
  → tool_call_log 업데이트 (status: executed, artifact_id)
```

### 11.3 Credential 주입 (`browser_type`)

```
browser_type({ ref: 5, text: "{{credential:EMAIL_PASSWORD}}" })
  → credential placeholder 감지
  → credential 값 resolve
  → BrowserManager.type_text(conv_id, 5, resolved_text, allow_password=true, skip_screenshot=true)
```

- `{{credential:KEY}}` 문법으로 비밀번호 필드에 안전하게 입력
- `allow_password=true`: 비밀번호 필드 보호 우회
- `skip_screenshot=true`: 입력 후 스크린샷 생략 (시각적 노출 방지)

---

## 12. Idle Cleanup

`BrowserSession::start_idle_cleanup` (앱 시작 시 호출):
- 60초 간격으로 모든 세션 점검
- `last_active`가 10분 이상 경과한 세션 자동 종료
- 앱 종료 시 idle_task abort

---

## 13. Tauri 커맨드

| 커맨드 | 설명 |
|--------|------|
| `approve_browser_domain` | 도메인 승인 (세션별 보안 정책) |
| `get_browser_artifact` | browser_artifacts 테이블 조회 |
| `get_browser_headless` | 현재 headless 설정 조회 |
| `set_browser_headless` | headless 모드 변경 (sidecar 재시작) |
| `get_browser_proxy` | 현재 프록시 URL 조회 |
| `set_browser_proxy` | 프록시 URL 변경 (sidecar 재시작) |
| `get_browser_no_proxy` | 현재 NO_PROXY 바이패스 목록 조회 |
| `set_browser_no_proxy` | NO_PROXY 바이패스 목록 변경 (sidecar 재시작) |
| `detect_system_proxy` | 시스템 프록시 설정 감지 (환경변수 + Windows 레지스트리) |
| `detect_system_no_proxy` | 시스템 NO_PROXY 설정 감지 |

---

## 14. Tauri 이벤트

| 이벤트 | 페이로드 | 시점 |
|--------|---------|------|
| `browser:chromium-installing` | `""` | Chromium 런타임 다운로드 시작 |
| `browser:chromium-installed` | `""` | Chromium 런타임 다운로드 완료 |
| `browser:chromium-install-failed` | `reason: String` | Chromium 다운로드 실패 |

프론트엔드 MainLayout에서 이 이벤트를 수신하여 Chromium 설치 진행 상태 UI를 표시한다.

---

## 소스 파일 참조

| 파일 | 역할 |
|------|------|
| `src-tauri/src/browser/mod.rs` | BrowserManager, BrowserSession, ElementRef, SidecarResponse 타입 + 코어 로직 |
| `src-tauri/src/browser/session.rs` | 세션 라이프사이클 (생성/종료/승인/idle cleanup/headless/proxy 설정) |
| `src-tauri/src/browser/sidecar.rs` | sidecar 프로세스 시작/경로 해석/시스템 프록시 감지 |
| `src-tauri/src/browser/security.rs` | URL 검증, SessionSecurityPolicy |
| `src-tauri/src/browser/commands.rs` | navigate/snapshot/click/type/wait/back 실행 |
| `src-tauri/src/browser/screenshot.rs` | BrowserToolResult 빌드, 스크린샷 저장 |
| `browser-sidecar/server.js` | Node.js HTTP 서버, Playwright 핸들러, 스냅샷 엔진 |
