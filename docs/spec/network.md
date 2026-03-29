# Network / Relay System

> 릴레이 서버를 통한 피어 간 E2E 암호화 통신 시스템. WebSocket 기반 프로토콜로 에이전트 간 메시징, 디렉토리 검색, 프레즌스 관리를 지원한다.

---

## 1. 프로토콜 메시지

### 1.1 ServerMessage (Server -> Client)

`shared/src/protocol.rs`에 정의. JSON tagged enum (`#[serde(tag = "type")]`).

| Variant | 필드 | 설명 |
|---------|------|------|
| `Challenge` | `nonce, server_time` | 인증 시작 (연결 즉시 전송) |
| `AuthOk` | `peer_id` | 인증 성공 |
| `Envelope` | `sender_peer_id, envelope: Value` | 다른 피어로부터의 암호화된 봉투 |
| `ServerAck` | `message_id, status: AckStatus` | 서버 수신 확인 (`Delivered` / `Queued`) |
| `PeerAck` | `message_id` | 상대 피어 수신 확인 |
| `Presence` | `peer_id, status: PresenceStatus, last_seen?` | 프레즌스 변경 (`Online` / `Offline`) |
| `PresenceSnapshot` | `peers: Vec<PeerPresenceInfo>` | 구독한 피어의 일괄 프레즌스 |
| `ProfileUpdated` | `discoverable: bool` | 디렉토리 프로필 업데이트 확인 |
| `DirectoryResult` | `query, peers[], total, offset` | 디렉토리 검색 결과 |
| `PeerProfileResult` | `peer: Option<DirectoryPeer>` | 단일 피어 프로필 |
| `Error` | `code, message` | 에러 |

### 1.2 ClientMessage (Client -> Server)

| Variant | 필드 | 설명 |
|---------|------|------|
| `Auth` | `peer_id, public_key (base64), signature` | nonce 서명으로 인증 |
| `Envelope` | `target_peer_id, envelope: Value` | 암호화된 봉투 전송 |
| `PeerAck` | `message_id, sender_peer_id` | 피어 수신 확인 |
| `SubscribePresence` | `peer_ids[]` | 프레즌스 구독 |
| `UpdateProfile` | `agent_name, agent_description, discoverable, agents?` | 디렉토리 프로필 등록/갱신 |
| `SearchDirectory` | `query, limit, offset` | 디렉토리 검색 |
| `GetPeerProfile` | `peer_id` | 단일 피어 프로필 조회 |

### 1.3 PublishedAgent

```rust
pub struct PublishedAgent {
    pub agent_id: String,
    pub name: String,
    pub description: String,
}
```

`UpdateProfile.agents`와 `DirectoryPeer.agents`에 포함되어 피어가 공개한 에이전트 목록을 전달한다.

---

## 2. Envelope / Payload (Application Layer)

`src-tauri/src/relay/envelope.rs`에 정의. 암호화 전 평문 메시지 구조.

### 2.1 Envelope

```rust
pub struct Envelope {
    pub version: u32,                   // PROTOCOL_VERSION = 1
    pub message_id: String,             // UUID
    pub correlation_id: Option<String>, // 응답 시 원본 message_id
    pub timestamp: String,              // RFC 3339
    pub sender_agent: String,           // "local" 또는 에이전트 이름
    pub payload: Payload,
}
```

### 2.2 Payload

```rust
pub enum Payload {
    Introduce {
        agent_name: String,
        agent_description: String,
        public_key: String,                        // base64
        published_agents: Option<Vec<PublishedAgent>>,
    },
    MessageRequest {
        content: String,
        target_agent_id: Option<String>,           // 상대방이 선택한 대상 에이전트
    },
    MessageResponse {
        content: String,
        responding_agent_id: Option<String>,        // 실제 응답한 에이전트
    },
    Ack {
        acked_message_id: String,
    },
    Error {
        code: String,
        message: String,
    },
}
```

`Envelope::new(sender_agent, payload)` 생성 시 `version`, `message_id`, `timestamp`가 자동 설정된다. `with_correlation(id)`로 correlation_id를 설정.

---

## 3. E2E 암호화

### 3.1 EncryptedEnvelope (Wire Format)

`shared/src/encrypted_envelope.rs`에 정의.

```rust
pub struct EncryptedEnvelope {
    pub header: EnvelopeHeader,           // 평문 (라우팅/dedup용, AAD로 사용)
    pub encrypted_payload: Vec<u8>,       // ChaCha20-Poly1305 암호문
    pub nonce: Vec<u8>,                   // 12 bytes
    pub sender_x25519_public: Vec<u8>,    // 32 bytes
}

pub struct EnvelopeHeader {
    pub version: u32,
    pub message_id: String,
    pub sender_agent: String,
    pub correlation_id: Option<String>,
    pub timestamp: String,
}
```

### 3.2 암호화 흐름

```
1. 키 변환:
   Ed25519 secret (32B) → SHA-512 hash → lower 32B → X25519 static secret
   Ed25519 public (32B) → Montgomery point → X25519 public key

2. DH 공유 비밀:
   shared_secret = X25519(sender_secret, receiver_public)

3. 대칭 키 유도:
   symmetric_key = HKDF-SHA256(shared_secret, info="wa-e2e-chacha20poly1305")

4. 암호화:
   ciphertext = ChaCha20-Poly1305(
     key = symmetric_key,
     nonce = random 12 bytes (OsRng),
     plaintext = Payload JSON bytes,
     aad = EnvelopeHeader canonical JSON
   )

5. 출력:
   EncryptedEnvelope { header, encrypted_payload, nonce, sender_x25519_public }
```

### 3.3 복호화 흐름

수신 측에서 동일한 과정을 역순으로 수행:
1. `sender_x25519_public`과 자신의 X25519 secret으로 DH 공유 비밀 계산
2. HKDF-SHA256으로 대칭 키 유도
3. header를 AAD로 하여 ChaCha20-Poly1305 복호화

---

## 4. Identity 시스템

### 4.1 NodeIdentity

```rust
pub struct NodeIdentity {
    signing_key: SigningKey,    // Ed25519 signing key
}
```

- 저장: `relay-identity.json` (tauri-plugin-store)
- 키: `ed25519_private_key` (hex 인코딩)
- `load_or_create(app)`: 저장된 키 로드 또는 새 키 생성 후 저장
- `generate()`: 새 Ed25519 키쌍 생성 (OsRng)

### 4.2 peer_id 생성

```
peer_id = hex(public_key[0..16])   // 32자 hex 문자열
```

공개키의 앞 16바이트를 hex로 인코딩하여 사용.

### 4.3 인증 흐름

```
Client          Server
  │── connect ──→│
  │←─ Challenge ─│  (nonce + server_time)
  │── Auth ─────→│  (peer_id + public_key_b64 + sign(nonce))
  │←─ AuthOk ───│  (peer_id 확인)
```

서버는 `known_keys`에 public_key를 등록하고 서명을 검증한다.

---

## 5. ContactCard / Invite

### 5.1 ContactCard (v2)

```rust
pub struct ContactCard {
    pub version: u32,               // 2
    pub peer_id: String,
    pub public_key: Vec<u8>,
    pub addresses: Vec<String>,
    pub relay_hints: Vec<String>,
    pub relay_url: Option<String>,
    pub expiry: Option<String>,
    pub agent_name: String,
    pub agent_description: String,
    pub created_at: String,
    pub signature: Vec<u8>,         // Ed25519 서명
}
```

### 5.2 초대 코드 흐름

**생성:**
```
generate_invite_with_relay(identity, addresses, agent_name, agent_desc, expiry_hours?, relay_url?)
  1. ContactCard 구성 (version=2)
  2. signable content (version, peer_id, public_key, addresses, relay_url, ...) 직렬화
  3. Ed25519 서명
  4. JSON → Base64-URL-safe 인코딩 → invite code 문자열
```

**수락:**
```
parse_invite(code)
  1. Base64-URL-safe 디코딩 → JSON
  2. ContactCard 파싱
  3. 서명 검증 (version별 signable content)
  4. 만료 확인 (expiry)
  5. ContactCard 반환
```

### 5.3 relay_accept_invite 흐름

```
relay_accept_invite(app, db, manager, code, local_agent_id?)
  1. parse_invite(code) → ContactCard
  2. invite에 relay_url이 있으면 설정에 저장
  3. 기존 contact 존재 시 업데이트, 없으면 신규 생성
  4. manager.register_peer_key() → 암호화용 키 등록
  5. manager.add_known_peer() → 즉시 통신 가능
  6. Introduce envelope 전송 (상대방에게 내 정보 + published_agents 전달)
  7. 프레즌스 구독
```

---

## 6. Capability 시스템

```rust
pub struct CapabilitySet {
    pub can_send_messages: bool,     // Phase 1: true
    pub can_read_agent_info: bool,   // Phase 1: true
    pub can_request_tasks: bool,     // Phase 2 예정
    pub can_access_tools: bool,      // Phase 2 예정
    pub can_write_vault: bool,       // Phase 2 예정
}
```

| 프리셋 | 설명 |
|--------|------|
| `default_phase1()` | `can_send_messages=true, can_read_agent_info=true`, 나머지 false |
| `deny_all()` | 모든 권한 false |

Contact 생성 시 `default_phase1()`이 기본값. `capabilities_json` 컬럼에 JSON으로 저장.

---

## 7. RelayManager 상태 머신

```
Dormant ──start()──→ Starting ──connected──→ Active
   ↑                                          │
   │                                     disconnect
   │                                          │
   │                                          ▼
   └───stop()────── Stopping ←──── Reconnecting
                                   (지수 백오프 1s→60s)
```

| 상태 | 설명 |
|------|------|
| `Dormant` | 초기 상태. 네트워크 비활성 |
| `Starting` | WebSocket 연결 시도 중 |
| `Active` | 연결 완료, 메시지 송수신 가능 |
| `Reconnecting` | 연결 끊김 후 지수 백오프로 재연결 시도 중 |
| `Stopping` | 연결 종료 중 |

### 7.1 RelayManager 내부 구조

```rust
pub struct RelayManager {
    identity: NodeIdentity,
    relay_handle: Arc<Mutex<Option<RelayHandle>>>,
    status: Arc<Mutex<NetworkStatus>>,
    known_peers: Arc<Mutex<HashSet<String>>>,          // DB peer_ids
    relay_id_index: Arc<Mutex<HashMap<String, String>>>, // relay_peer_id → db_peer_id
    peer_keys: Arc<Mutex<HashMap<String, ([u8;32], String)>>>, // db_peer_id → (ed25519_pub, relay_peer_id)
    peer_presence: Arc<RwLock<HashMap<String, PresenceStatus>>>,
}
```

### 7.2 주요 기능

- `start(app)`: WebSocket 연결 시작, 이벤트 루프 spawn
- `stop()`: 연결 종료
- `send_message(peer_id, envelope)`: 암호화 + 전송
- `send_raw_envelope(peer_id, encrypted_json)`: 이미 암호화된 봉투 전송
- `encrypt_for_peer(peer_id, envelope)`: E2E 암호화
- `register_peer_key(peer_id, public_key_b64)`: 피어 공개키 등록
- `add_known_peer(peer_id)` / `remove_known_peer(peer_id)`: 알려진 피어 관리
- `is_peer_authenticated(peer_id)`: 피어 인증 여부 확인
- `search_directory(query, limit, offset)`: 디렉토리 검색
- `update_directory_profile(name, desc, discoverable, agents?)`: 프로필 갱신

---

## 8. Secretary 자동응답

수신된 `MessageRequest`에 대해 자동으로 LLM 응답을 생성하는 시스템.

### 8.1 handle_incoming_message 흐름

```
handle_incoming_message(app, db, contact_peer_id, envelope):
  1. Payload 추출 (content, target_agent_id)
  2. contact 조회 (peer_id로)
  3. 스레드 라우팅:
     - target_agent_id → 해당 에이전트 전용 스레드 (없으면 생성)
     - target_agent_id 없음 → 기존 첫 스레드 또는 신규 생성
  4. 수신 메시지 DB 저장 (direction: incoming, delivery_state: received)
  5. relay:incoming-message 이벤트 emit
  6. 자동응답 판단:
     - contact.status가 accepted 또는 pending_approval
     - payload가 MessageRequest (MessageResponse는 무시)
  7. ACTIVE_THREADS 락으로 동시 응답 방지
  8. tokio::spawn → 미응답 메시지 루프:
     - correlation_id로 응답 여부 판별
     - 미응답 메시지마다 generate_and_send_response() 호출
     - 모든 메시지 응답 완료 후 ACTIVE_THREADS에서 제거
```

### 8.2 resolve_agent_id 우선순위

```
resolve_agent_id(app, db, contact, thread_id, target_agent_id?):
  1. target_agent_id (방문자 선택) — network_visible 검증 필수
  2. thread.local_agent_id (스레드 바인딩)
  3. contact.local_agent_id (연락처 바인딩)
  4. default agent (is_default=true)
```

### 8.3 generate_and_send_response 상세

```
generate_and_send_response(app, contact, thread_id, incoming_message_id):
  1. relay:auto-response-started 이벤트 emit

  2. resolve_agent_id()로 응답 에이전트 결정

  3. ExecutionScope 구성:
     - role: RelayResponse
     - trigger: BackendTriggered

  4. resolve_with_settings()로 persona/tools/memory 해석
     - allowed_tools: AppSettings.allowed_tools (비어있으면 기본 읽기전용)
     - model_name, company_name 오버라이드

  5. 시스템 프롬프트 구성:
     - build_system_prompt(resolved, scope)
     - [PEER CONTEXT] 섹션 추가:
       "You are conversing with an external peer (from another organization/user)."
       "Peer display name: {display_name}"
       "Peer agent: {agent_name} ({agent_description})"

  6. 스레드 최근 50개 메시지 조회 → 대화 히스토리 구성
     - incoming → role: user
     - outgoing → role: assistant

  7. credential 스크러빙

  8. LLM 호출 (tool loop, max 10 iterations):
     - do_completion() → 도구 호출 있으면 실행 후 재호출
     - 브라우저 스크린샷은 base64 이미지로 변환하여 멀티모달 입력
     - thinking 에러 시 자동 폴백

  9. 응답 메시지 DB 저장 (direction: outgoing, responding_agent_id 포함)

  10. relay:auto-response-done 이벤트 emit

  11. MessageResponse envelope 구성 (correlation_id 설정)

  12. 암호화 → 전송 (실패 시 outbox에 큐잉)
```

---

## 9. 에이전트 공개 (network_visible)

### 9.1 동작

- `agents` 테이블의 `network_visible` 컬럼 (INTEGER DEFAULT 0)
- AgentEditor에서 "네트워크에 공개" 토글로 설정
- `list_network_visible_agents_impl(db)`: network_visible=1인 에이전트 목록 조회

### 9.2 전파 경로

1. **UpdateProfile**: relay 서버에 `agents: Vec<PublishedAgent>` 전달
2. **Introduce**: 새 contact에게 공개 에이전트 목록 전달
3. **DirectoryResult**: 디렉토리 검색 결과에 agents 포함
4. **ContactRow.published_agents_json**: 상대방의 공개 에이전트 목록 DB 저장

### 9.3 상대방 에이전트 선택

PeerChatInput에서 드롭다운으로 상대방의 공개 에이전트를 선택하여 대화 가능. `MessageRequest.target_agent_id`에 에이전트 ID가 포함되며, 상대방의 `resolve_agent_id()`에서 최우선으로 처리된다.

---

## 10. 프론트엔드 메시지 표시

### 10.1 기본 모드 ("내 대화")

UI에서 보낸 메시지와 그에 대한 응답만 표시:
- `direction=outgoing` AND `responding_agent_id=null` (사용자가 직접 보낸 메시지)
- `direction=incoming` AND `correlation_id`가 위 메시지에 연결된 응답

### 10.2 전체 보기

모든 메시지 표시:
- 상대방이 보낸 요청 (`direction=incoming`)
- 내 에이전트의 자동응답 (`direction=outgoing`, `responding_agent_id != null`)

### 10.3 토글

PeerThread 헤더의 전체/내 대화 토글로 전환. `showAllMessages` 상태로 관리.

---

## 11. 대화 기록 관리

| Tauri 커맨드 | 설명 |
|-------------|------|
| `relay_clear_thread_messages(thread_id)` | 스레드의 모든 메시지 일괄 삭제 |
| `relay_delete_thread(thread_id)` | 스레드 자체 삭제 (CASCADE로 메시지도 삭제) |

UI에서 삭제 버튼은 2단계 확인:
1. 첫 클릭 → confirm 상태 활성화
2. 3초 내 재클릭 → 실행
3. 3초 경과 → 원래 상태로 복귀

---

## 12. Relay Server

`relay-server/` 디렉토리에 위치한 독립 서버 프로세스. axum + WebSocket.

### 12.1 DB 테이블

**offline_queue:**
```sql
CREATE TABLE offline_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    target_peer_id  TEXT NOT NULL,
    sender_peer_id  TEXT NOT NULL,
    message_id      TEXT NOT NULL,
    envelope_json   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oq_target ON offline_queue(target_peer_id, created_at);
```

- Per-peer cap: 1000개 (oldest evicted)
- TTL: 7일 (drain 시 자동 정리)
- PeerAck 수신 시 `remove_by_message_id()`로 개별 삭제

**peer_directory:**
```sql
CREATE TABLE peer_directory (
    peer_id           TEXT PRIMARY KEY,
    public_key        TEXT NOT NULL,
    agent_name        TEXT NOT NULL DEFAULT '',
    agent_description TEXT NOT NULL DEFAULT '',
    discoverable      INTEGER NOT NULL DEFAULT 1,
    agents_json       TEXT,                           -- PublishedAgent[] JSON
    last_seen         TEXT NOT NULL DEFAULT (datetime('now')),
    registered_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pd_discoverable ON peer_directory(discoverable, agent_name);
```

### 12.2 AppState (in-memory)

```rust
pub struct AppState {
    connections: RwLock<HashMap<String, (WsSender, String)>>,       // peer_id → (ws_sender, session_id)
    known_keys: RwLock<HashMap<String, Vec<u8>>>,                   // peer_id → ed25519 public key
    presence_subscriptions: RwLock<HashMap<String, HashSet<String>>>, // subscriber → subscribed_peers
    seen_messages: Mutex<HashMap<String, Instant>>,                  // message_id → timestamp (1hr dedup)
    search_rate_limits: RwLock<HashMap<String, (u32, Instant)>>,    // peer_id → (count, window_start)
    db: SqlitePool,
}
```

- **single-session policy:** 같은 peer_id가 새로 연결하면 기존 연결을 닫음
- **message dedup:** `seen_messages`에 1시간 TTL로 message_id 저장
- **search rate limit:** 피어당 60초에 10회 제한

---

## 13. Tauri 커맨드 목록

### Lifecycle

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_start` | (없음) | `()` |
| `relay_stop` | (없음) | `()` |
| `relay_status` | (없음) | `String` (상태명) |
| `relay_get_peer_id` | (없음) | `String` |

### Invite

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_generate_invite` | `agent_name, agent_description, addresses[], expiry_hours?` | `String` (invite code) |
| `relay_accept_invite` | `code, local_agent_id?` | `ContactRow` |

### Contact 관리

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_list_contacts` | (없음) | `Vec<ContactRow>` |
| `relay_update_contact` | `id, display_name?, local_agent_id?, mode?` | `()` |
| `relay_remove_contact` | `id` | `()` |
| `relay_bind_agent` | `contact_id, agent_id` | `()` |
| `relay_approve_contact` | `contact_id` | `()` |
| `relay_reject_contact` | `contact_id` | `()` |

### 메시징

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_send_message` | `contact_id, content, target_agent_id?` | `()` |

메시지 전송 흐름:
1. contact 조회 (pending_approval이면 자동 accept)
2. 스레드 조회/생성
3. Envelope 구성 (Payload::MessageRequest)
4. peer_message 저장 (outgoing, approved)
5. outbox 저장
6. 피어 인증 안 됐으면 queued로 전환
7. 인증 됐으면 암호화 → 전송
8. 실패 시 queued + exponential backoff retry (30s * 2^n, max 4)

### Thread 관리

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_list_threads` | `contact_id` | `Vec<PeerThreadRow>` |
| `relay_get_thread` | `thread_id` | `Option<PeerThreadRow>` |
| `relay_get_thread_messages` | `thread_id` | `Vec<PeerMessageRow>` |
| `relay_delete_thread` | `thread_id` | `()` |
| `relay_clear_thread_messages` | `thread_id` | `()` |

### 네트워크 설정

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_get_network_enabled` | (없음) | `bool` |
| `relay_set_network_enabled` | `enabled: bool` | `()` |
| `relay_get_relay_url` | (없음) | `String` |
| `relay_set_relay_url` | `url: String` | `()` |
| `relay_get_allowed_tools` | (없음) | `Vec<String>` |
| `relay_set_allowed_tools` | `tools: Vec<String>` | `()` |

### 디렉토리

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_search_directory` | `query, limit?, offset?` | `()` (결과는 DirectoryResult 이벤트로) |
| `relay_send_friend_request` | `target_peer_id, target_public_key, target_agent_name, target_agent_description, local_agent_id?` | `ContactRow` |
| `relay_update_directory_profile` | `agent_name, agent_description, discoverable` | `()` |
| `relay_get_directory_settings` | (없음) | `{ discoverable, agent_name, agent_description }` |
| `relay_set_directory_settings` | `discoverable: bool` | `()` |

### 연결 정보

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `relay_get_connection_info` | (없음) | `ConnectionInfo { peer_id, relay_url, status }` |

---

## 14. Tauri 이벤트

| 이벤트명 | 페이로드 | 발생 시점 |
|----------|---------|----------|
| `relay:connection-state` | `{ status, peer_count }` | 연결 상태 변경 |
| `relay:incoming-message` | `{ peer_id, thread_id, message_id }` | 메시지 수신 |
| `relay:delivery-update` | `{ message_id, state }` | 전송 상태 변경 (sent, delivered 등) |
| `relay:presence-update` | `{ peer_id, status }` | 피어 온/오프라인 |
| `relay:auto-response-started` | `{ thread_id }` | 자동응답 생성 시작 |
| `relay:auto-response-done` | `{ thread_id }` | 자동응답 완료 |
| `relay:auto-response-error` | `{ thread_id, error }` | 자동응답 실패 |
| `relay:directory-result` | `{ query, peers[], total, offset }` | 디렉토리 검색 결과 |
| `relay:error` | `{ code, message }` | 릴레이 에러 |

---

## 15. 프론트엔드

### 15.1 Store

| Store | 파일 | 역할 |
|-------|------|------|
| `useNetworkStore` | `src/stores/networkStore.ts` | 네트워크 전체 상태 관리 |

**주요 상태:**
- `status: NetworkStatus` (dormant/starting/active/stopping/reconnecting)
- `peerId: string | null`
- `networkEnabled: boolean`
- `contacts: ContactRow[]`, `selectedContactId`, `selectedThreadId`
- `threads: PeerThreadRow[]`, `messages: PeerMessageRow[]`
- `pendingApprovals: number`
- `connectedPeers: Set<string>` -- 실시간 연결된 피어
- `generatingThreads: Set<string>` -- 자동응답 생성 중인 스레드
- `directoryResults: DirectoryPeer[]`, `directoryTotal`, `directoryLoading`
- `discoverable: boolean`, `showAllMessages: boolean`

**주요 액션:**
- `initialize()`, `startNetwork()`, `stopNetwork()`, `refreshStatus()`, `refreshContacts()`
- `generateInvite(name, desc, hours?)`, `acceptInvite(code, agentId?)`
- `selectContact(id)`, `selectThread(id)`, `loadThreadMessages(threadId)`
- `sendMessage(contactId, content, targetAgentId?)`
- `approveContact(id)`, `rejectContact(id)`
- `searchDirectory(query)`, `sendFriendRequest(...)`
- `setDiscoverable(bool)`, `updateProfile(...)`
- `toggleShowAllMessages()`

### 15.2 Components

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| `NetworkPanel` | `src/components/network/NetworkPanel.tsx` | 네트워크 메인 레이아웃 (연결 상태, 연락처 목록, 대화) |
| `ContactList` | `src/components/network/ContactList.tsx` | 연락처 목록 + 대기 중 승인 배지 |
| `ContactDetail` | `src/components/network/ContactDetail.tsx` | 연락처 상세 (에이전트 바인딩, 모드 설정) |
| `PeerThread` | `src/components/network/PeerThread.tsx` | 피어 대화 스레드 뷰 (전체/내 대화 토글, 삭제) |
| `PeerMessageBubble` | `src/components/network/PeerMessageBubble.tsx` | 개별 메시지 버블 |
| `PeerChatInput` | `src/components/network/PeerChatInput.tsx` | 피어 대화 입력 (에이전트 선택 드롭다운) |
| `InviteDialog` | `src/components/network/InviteDialog.tsx` | 초대 코드 생성/수락 다이얼로그 |
| `DeliveryBadge` | `src/components/network/DeliveryBadge.tsx` | 메시지 전송 상태 배지 (pending/queued/sent/delivered) |
