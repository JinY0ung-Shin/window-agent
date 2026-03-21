# libp2p → WebSocket Relay 마이그레이션 설계안

## 배경
현재 window-agent는 libp2p 0.54 (Rust) 기반 P2P 네트워킹을 사용 중이다.
구현이 과도하게 복잡하여(~5119줄, 6개 프로토콜 스택) 유지보수가 어렵다.
WebSocket 릴레이 서버 방식으로 교체하여 복잡도를 대폭 낮춘다.

### 현재 구현의 복잡도 요인
- **libp2p 프로토콜 스택**: TCP + Noise + Yamux + mDNS + Relay + DCUTR + AutoNAT
- **커스텀 4단계 핸드셰이크**: Noise 암호화 위에 별도 Ed25519 서명 인증 (security.rs, 595줄)
- **이중 디스커버리**: mDNS (LAN) + 초대코드 기반 수동 주소 교환
- **667줄 이벤트 루프** (event_loop.rs): 연결 생명주기, 핸드셰이크 상태머신, 메시지 라우팅, 재연결 로직
- **재시도/outbox 시스템**: 지수 백오프, 5분 주기 재연결, stale 핸드셰이크 정리

### 유지해야 할 기능
1. **에이전트 간 메시지 교환**: 텍스트 메시지 송수신 + ACK
2. **인증/권한 제어**: known peer만 통신 허용, capability 기반 권한
3. **초대 기반 피어 추가**: 초대코드로 연락처 교환
4. **오프라인 대응**: 재연결 + 대기 메시지 재전송
5. **보안**: E2E 암호화, 서명 검증

### 교체 결정 근거
Claude, Codex, Gemini 3자 리뷰 결과 WebSocket relay를 최종 선택.
- 현재 코드가 이미 transport-agnostic하게 분리되어 있음 (envelope.rs, secretary.rs, db.rs)
- libp2p 전용 레이어(~2046줄)만 교체하면 되므로 마이그레이션 비용 최저
- 오프라인 메시지 문제를 서버 측 큐로 자연스럽게 해결
- P2P가 프로젝트 핵심 요구사항이 아님 (에이전트 간 메시지 교환이 핵심)

---

## 코드 파일별 처분 계획

### 수정하여 유지
| 파일 | 줄 수 | 변경 내용 |
|------|-------|----------|
| `envelope.rs` | 162 | `EncryptedEnvelope` 래퍼 추가 (헤더 평문 + payload 암호문), `Payload::Handshake` variant 제거 |
| `secretary.rs` | 459 | 수신 시 `sender_peer_id` 파라미터 추가 (서버가 제공), 복호화 후 기존 로직 |
| `db.rs` | 965 | `addresses_json` 컬럼 미사용 처리 (삭제하지 않고 무시). 신규 컬럼 없음 |
| `identity.rs` | 190 | X25519 공개키 도출 메서드 추가 (`to_x25519_public()`) |
| `capability.rs` | 116 | 변경 없음 |
| `contact_card.rs` | 319 | `addresses` 필드를 optional로 변경, 버전 필드 추가 (`version: u32`), `peer_id`↔`public_key` 일관성 검증 추가 |
| `invite.rs` | 137 | 버전화된 초대 포맷 지원, v2 초대에서 addresses 생략 |
| `mod.rs` | 11 | export 목록 조정 (security 제거, crypto/relay_client 추가) |

### 삭제
| 파일 | 줄 수 | 사유 |
|------|-------|------|
| `transport.rs` | 28 | libp2p Swarm 빌더 — WS 연결로 대체 |
| `protocol.rs` | 50 | AgentBehaviour (mdns, request_response 등) — 불필요 |
| `security.rs` | 595 | 4단계 핸드셰이크 — crypto.rs + 서버 challenge/response로 대체 |
| `manager/event_loop.rs` | 667 | libp2p SwarmEvent 처리 — WS 수신 루프로 대체 |
| `manager/helpers.rs` | 344 | libp2p 연결 헬퍼 — 불필요 |

### 교체 (대폭 재작성)
| 파일 | 현재 줄 수 | 예상 줄 수 | 내용 |
|------|-----------|-----------|------|
| `manager/mod.rs` | 362 | ~200 | P2PManager → RelayManager. `authenticated_peers` 제거, `known_peers` (연락처 DB 기반) + relay 연결 상태로 전환 |

### 신규
| 파일 | 예상 줄 수 | 내용 |
|------|-----------|------|
| `relay_client.rs` | ~200 | WS 연결, challenge/response 인증, 메시지 송수신, presence 구독 |
| `crypto.rs` | ~120 | X25519 DH 키교환 + ChaCha20-Poly1305 E2E 암호화 + EncryptedEnvelope 직렬화 |
| `relay-server/` | ~400 | 릴레이 서버 (별도 Rust crate) |

### 영향받는 추가 파일 (Phase 5에서 수정)
| 파일 | 변경 내용 |
|------|----------|
| `src-tauri/src/lib.rs` | P2PManager 초기화 → RelayManager 초기화로 변경 (L75-78) |
| `src-tauri/src/commands/p2p_commands.rs` (714줄) | multiaddr/listen-port 명령 제거, relay URL 추가, `p2p_send_message`에서 per-peer auth gating 제거, `p2p_accept_invite`에서 PeerId 파싱/dial 제거 |
| `src/services/commands/p2pCommands.ts` | multiaddr 관련 API 제거, relay URL API 추가, Contact 타입에서 addresses 제거 |
| `src/components/network/InviteDialog.tsx` | 수동 주소 입력 UI 제거, 초대코드만 유지 |
| `src/components/network/ContactDetail.tsx` | multiaddr 표시 제거, 온라인/오프라인 상태 표시 |
| `src/components/settings/NetworkSettingsPanel.tsx` | listen-port 설정 → relay URL 설정 |
| `src/stores/networkStore.ts` | listen_port/addresses → relay_url/connection_status/peer_presence |
| `src/components/network/PeerThread.tsx` | 피어 온라인 상태를 presence 이벤트 기반으로 변경 |

---

## E2E 암호화 설계

릴레이 서버가 메시지 내용을 볼 수 없도록 E2E 암호화를 구현한다.

### 키 체계
- **기존 Ed25519 키** (identity.rs): 서명/릴레이 인증 용도로 유지
- **X25519 키**: Ed25519 키에서 X25519로 변환하여 DH 키교환에 사용 (ed25519-dalek의 `to_montgomery()`)
- **세션 키**: X25519 DH → HKDF → ChaCha20-Poly1305 대칭키 도출

### EncryptedEnvelope 구조
```rust
/// 와이어 포맷: 서버가 라우팅 가능한 헤더 + E2E 암호화된 payload
struct EncryptedEnvelope {
    version: u32,              // = 1
    message_id: String,        // UUID — 평문 (dedupe/ACK에 사용)
    sender_agent: String,      // 평문 (라우팅에 사용)
    // sender_peer_id는 서버가 인증된 WS 세션에서 첨부 — 클라이언트가 설정하지 않음
    correlation_id: Option<String>,
    timestamp: String,         // RFC3339
    encrypted_payload: Vec<u8>, // ChaCha20-Poly1305 암호문 (AAD = 헤더 직렬화)
    nonce: [u8; 12],           // AEAD nonce
    sender_x25519_public: [u8; 32], // 수신자가 DH에 사용
}
```

### AEAD Associated Data (헤더 변조 방지)
평문 헤더(version, message_id, sender_agent, correlation_id, timestamp)를 ChaCha20-Poly1305의 **Associated Data (AAD)**로 바인딩한다. 이를 통해:
- 서버가 헤더를 변조하면 복호화 시 인증 실패 → 메시지 거부
- AAD 구성: 헤더 필드를 **canonical JSON 직렬화**한 바이트. 구체적으로 `serde_json::to_vec(&header)` 사용 (필드 순서 고정, 구분자 모호성 없음)
  ```rust
  #[derive(Serialize)]
  struct AadHeader { version: u32, message_id: String, sender_agent: String, correlation_id: Option<String>, timestamp: String }
  let aad = serde_json::to_vec(&header)?;
  ```

### 초대 수용 시 공개키 교환 (Introduce 부트스트랩)
**문제**: 초대를 수용한 측이 Introduce 메시지를 보내려면 E2E 암호화가 필요한데, 초대자 측은 아직 수용자의 공개키를 모름.

**해결**: 초대코드에 이미 초대자의 공개키가 포함되어 있으므로:
1. **수용자 → 초대자**: 수용자는 초대코드에서 초대자의 공개키를 알고 있음 → 정상적으로 E2E 암호화 가능
2. **초대자 측 수신**: Introduce 메시지 수신 시 `sender_x25519_public` 필드에서 수용자의 X25519 공개키를 추출
3. **공개키 등록**: secretary.rs에서 Introduce 처리 시, `sender_peer_id`로 contacts DB에 pending_approval 상태로 등록하면서 `sender_x25519_public`에서 Ed25519 공개키를 역추론하지 않고, **Introduce payload 안에 Ed25519 공개키를 포함**시킴
4. **Introduce payload 확장**:
   ```rust
   Payload::Introduce {
       agent_name: String,
       agent_description: String,
       public_key: String,  // 신규: Ed25519 공개키 (base64)
   }
   ```
5. 초대자는 수신한 공개키를 contacts DB에 저장 → 이후 양방향 E2E 통신 가능

**secretary.rs 변경**: `handle_incoming_message()`에서 sender_peer_id가 known_peers에 없고 Payload가 Introduce인 경우:
- **검증**: `payload.public_key`에서 peer_id를 도출하여 `sender_peer_id`와 일치하는지 확인. 불일치 시 메시지 거부 (공개키 위조 방지)
- pending_approval 상태로 contact 생성 (기존 helpers.rs의 auto-registration 대체)
- public_key 저장
- 이 경우에만 known_peers 체크를 우회 (Introduce는 미등록 피어에서도 수신 가능)
- **메모리 갱신**: DB insert 후 `RelayManager.known_peers.insert(sender_peer_id)` 호출하여 이후 메시지 수신 가능하도록 함

### 암호화 흐름
1. 초대 수용 시 상대의 Ed25519 공개키 저장 (현재와 동일 — contact_card.rs의 `public_key`)
2. 메시지 전송 시:
   - sender Ed25519 → X25519 private, receiver Ed25519 public → X25519 public
   - X25519 DH → shared_secret
   - HKDF(shared_secret, nonce) → symmetric_key
   - 헤더 필드를 AAD로 직렬화
   - ChaCha20-Poly1305로 `Payload` JSON 암호화 (AAD 바인딩)
   - EncryptedEnvelope 생성 (헤더 평문 + 암호화된 payload)
3. 수신 시:
   - 서버가 첨부한 `sender_peer_id`로 연락처 DB에서 공개키 조회
   - Introduce인 경우: `sender_x25519_public`에서 DH 수행 (아직 DB에 공개키 없으므로)
   - 동일 DH → symmetric_key 도출 → AAD 재구성 → 복호화 (AAD 불일치 시 거부)
   - 복호화된 Payload를 secretary.rs에 전달

### DB/와이어 포맷 마이그레이션
- `peer_messages.raw_envelope` 컬럼: 기존 평문 Envelope JSON → EncryptedEnvelope JSON으로 변경
- 기존 메시지는 `version` 필드 없음 → 레거시로 간주, 읽기만 가능
- 신규 메시지는 `version: 1` + 암호화된 형태로 저장

### 라이브러리
- `x25519-dalek`: DH 키교환
- `chacha20poly1305`: AEAD 암호화
- `hkdf` + `sha2`: 키 도출

> 초기에는 정적 DH만 구현. 향후 Double Ratchet 추가 검토.

---

## 릴레이 서버 설계

### 최소 기능
1. **클라이언트 인증**: challenge/response 방식 (서버가 nonce 발급 → 클라이언트가 Ed25519 서명 → 서버 검증)
2. **메시지 라우팅**: target_peer_id 기반으로 연결된 클라이언트에게 전달, 서버가 `sender_peer_id`를 인증된 세션에서 첨부
3. **오프라인 큐**: 대상이 미접속 시 메시지를 저장, 접속 시 drain
4. **ACK 전달**: 수신자의 ACK을 발신자에게 전달
5. **중복 제거**: `message_id` 기반 dedupe
6. **Presence 구독/알림**: 클라이언트가 `subscribe_presence`로 감시할 peer_ids 등록 → 해당 피어 접속/해제 시 presence 이벤트 전송 + 구독 시 현재 상태 스냅샷 반환

### 서버가 하지 않는 것
- 메시지 내용 복호화 (E2E 암호화된 payload만 중계)
- 연락처/초대 관리 (클라이언트 로컬)
- capability/승인 처리 (클라이언트 로컬)

### 기술 스택
- **Fly.io + Rust** (axum + tokio-tungstenite)
- Tauri 앱과 동일한 Rust, Envelope 타입 공유 가능
- Cargo workspace로 구성: `relay-server/` 별도 crate, 공유 타입은 `shared/` crate

### 오프라인 큐 사양
- 저장 한도: peer당 최대 1000건 또는 10MB
- TTL: 7일 (만료된 메시지 자동 삭제)
- 재접속 시: 큐에 쌓인 메시지를 시간순으로 전송, 각각에 대해 ACK 수신 후 큐에서 삭제
- 영속성: SQLite (Fly.io volume)

### WS 프로토콜 (v1)
```
=== 인증 (challenge/response) ===

서버 → 클라이언트 (연결 즉시):
{
  "type": "challenge",
  "nonce": "random-32-bytes-base64",
  "server_time": "2026-03-21T..."
}

클라이언트 → 서버:
{
  "type": "auth",
  "peer_id": "...",
  "signature": "base64..."  // Ed25519 sign(nonce + peer_id)
}

서버 → 클라이언트:
{
  "type": "auth_ok",
  "peer_id": "..."  // 서버가 확인한 peer_id
}

=== 메시지 ===

클라이언트 → 서버:
{
  "type": "envelope",
  "target_peer_id": "...",
  "envelope": { ... }  // EncryptedEnvelope
}

서버 → 클라이언트 (수신):
{
  "type": "envelope",
  "sender_peer_id": "...",  // 서버가 인증된 세션에서 첨부
  "envelope": { ... }       // EncryptedEnvelope
}

=== ACK (2단계) ===

1단계: 서버 ACK (서버가 메시지를 수신/큐잉 완료)
서버 → 발신자:
{ "type": "server_ack", "message_id": "...", "status": "delivered" | "queued" }
  - "delivered": 수신자가 온라인이어서 즉시 전달됨
  - "queued": 수신자가 오프라인이어서 큐에 저장됨
  → 발신자 outbox: delivery_state = "delivered" 또는 "queued"

2단계: 피어 ACK (수신자가 메시지를 성공적으로 복호화/처리)
수신자 → 서버:
{ "type": "peer_ack", "message_id": "...", "sender_peer_id": "..." }
  → 서버: 오프라인 큐에서 해당 메시지 삭제
  → 서버: sender_peer_id가 온라인이면 peer_ack 전달, 오프라인이면 버림 (발신자는 다음 접속 시 자체 재확인)

서버 → 발신자 (피어 ACK 전달, 발신자가 온라인인 경우):
{ "type": "peer_ack", "message_id": "..." }
  → 발신자 outbox: delivery_state = "delivered" (queued → delivered 전환)

### 전달 보장 수준
- **At-least-once delivery**: 의도적 설계. 수신자가 처리 후 peer_ack 전송 전 크래시 시 재전달 발생 가능.
- **수신자 dedupe**: 클라이언트는 `peer_messages.message_id_unique` 컬럼으로 수신 dedupe 수행 (이미 존재하는 메시지 ID → 무시, ACK만 재전송). 현재 코드에 이미 UNIQUE 제약조건 존재.
- **발신자 peer_ack 미수신**: 발신자가 오프라인일 때 peer_ack은 유실됨. 발신자는 "queued" 상태 메시지에 대해 별도 확인하지 않음 (eventually consistent — 수신자가 응답 메시지를 보내면 자연스럽게 확인).

=== 에러 ===

서버 → 클라이언트:
{ "type": "error", "code": "...", "message": "..." }

=== Presence 구독 ===

클라이언트 → 서버 (인증 후, 연락처 변경 시 재전송):
{
  "type": "subscribe_presence",
  "peer_ids": ["peer_id_1", "peer_id_2", ...]  // 감시할 피어 목록
}

서버 → 클라이언트 (구독된 피어의 상태 변경 시):
{
  "type": "presence",
  "peer_id": "...",
  "status": "online" | "offline",
  "last_seen": "2026-03-21T..."  // offline일 때만
}

서버 → 클라이언트 (subscribe_presence 응답, 현재 상태 일괄):
{
  "type": "presence_snapshot",
  "peers": [
    { "peer_id": "...", "status": "online" | "offline", "last_seen": "..." },
    ...
  ]
}

=== Heartbeat ===
클라이언트 ↔ 서버: WebSocket ping/pong (30초 간격)
```

### 인증 보안
- 서버가 nonce 발급 → 리플레이 불가
- 클라이언트는 nonce + peer_id를 Ed25519로 서명
- **Self-certifying PeerId**: `peer_id`는 Ed25519 공개키의 해시(또는 인코딩)에서 도출. 따라서:
  - 클라이언트의 auth 메시지에 `public_key` 필드 추가: `{ "type": "auth", "peer_id": "...", "public_key": "base64...", "signature": "..." }`
  - 서버는 `peer_id == derive(public_key)`를 검증한 후 서명 검증
  - 첫 연결: 서버가 `peer_id → public_key` 매핑을 등록
  - 이후 연결: 서버가 저장된 public_key와 일치하는지 확인 (키 변경 시 거부)
  - 이를 통해 TOFU 위험 없이 첫 인증 가능 (공개키가 peer_id에 바인딩)
- clock skew: 서버 시간 기준 5분 이내 (server_time 필드로 클라이언트가 drift 보정)
- 동일 peer_id 중복 세션: 새 연결이 기존 연결을 대체 (단일 세션 정책)

### Introduction 메시지 (초대 수용 알림)
초대를 수용한 측이 초대자에게 자신의 identity를 알리는 메커니즘:

```
클라이언트 → 서버:
{
  "type": "envelope",
  "target_peer_id": "inviter_peer_id",
  "envelope": {
    // EncryptedEnvelope with Payload::Introduce { agent_name, agent_description }
  }
}
```

- 초대자 측: secretary.rs에서 Introduce payload 수신 → contacts DB에 `pending_approval` 상태로 등록 (기존 helpers.rs의 auto-registration 대체)
- 이미 Envelope에 `Payload::Introduce` variant가 존재하므로 새 메시지 타입 불필요

---

## 인증/권한 모델 (relay 버전)

### 기존 모델과의 차이
| 개념 | libp2p (현재) | Relay (신규) |
|------|-------------|-------------|
| 피어 인증 | 4단계 핸드셰이크 → `authenticated_peers` | 서버 challenge/response → 서버가 sender_peer_id 보장 |
| 전송 게이팅 | `is_peer_authenticated()` 필수 | **제거** — 메시지는 항상 서버로 전송 가능 (서버가 큐잉/전달) |
| 수신 게이팅 | known_peers 확인 + capability 체크 | known_peers 확인 + capability 체크 (현행 유지, secretary.rs) |
| 연결 상태 | per-peer TCP 연결 | 단일 WS 연결 (서버) + presence 이벤트 |

### 상태 모델
```
RelayManager:
  - relay_connected: bool       // WS 연결 상태
  - known_peers: HashSet<String> // contacts DB에서 로드 (현행 유지)
  - peer_presence: HashMap<String, PeerStatus>  // 서버 presence 이벤트에서 갱신
  // authenticated_peers: 제거 (서버가 인증 보장)
```

### 전송 흐름 변경
```
기존: p2p_send_message → is_peer_authenticated()? → swarm.send_request()
신규: p2p_send_message → is_relay_connected()? → relay_client.send() → 서버가 큐잉/전달
      (상대가 오프라인이어도 전송 가능 — 서버가 큐)
```

---

## 마이그레이션 Phase 계획

### Phase 0: 사전 준비
> 커밋 단위: 1개.

1. libp2p 코드를 `p2p-legacy` 브랜치로 보존 (`git branch p2p-legacy`)
2. 기존 94개 P2P 테스트에서 transport-independent 테스트 목록 식별
3. 새 `ws-relay` 브랜치 생성
4. **Cargo workspace 구성**: 루트 `Cargo.toml`에 workspace members 추가
   - `src-tauri/` (기존 Tauri 앱)
   - `relay-server/` (신규 릴레이 서버)
   - `shared/` (신규 공유 타입: EncryptedEnvelope, WS 프로토콜 메시지 등)
5. **WS 클라이언트 의존성 추가**: `src-tauri/Cargo.toml`에 `tokio-tungstenite`, `futures-util` 추가
6. **WS 서버 의존성**: `relay-server/Cargo.toml`에 `axum`, `tokio-tungstenite`, `sqlx` (SQLite) 추가

### Phase 1: 공유 타입 + E2E 암호화 모듈
> 커밋 단위: 1개. libp2p 코드에 영향 없음.

1. `shared/` crate 생성: `EncryptedEnvelope`, WS 프로토콜 메시지 타입 정의
2. `src-tauri/src/p2p/crypto.rs` 생성
3. X25519 DH 키교환 구현 (ed25519 → x25519 변환)
4. ChaCha20-Poly1305 encrypt/decrypt 구현
5. `identity.rs`에 `to_x25519_public()` 메서드 추가
6. 단위 테스트: 키 변환, 암호화/복호화 라운드트립, 2명의 키페어로 상호 암복호화
7. `Cargo.toml`에 `x25519-dalek`, `chacha20poly1305`, `hkdf`, `sha2` 추가

### Phase 2: 릴레이 서버 구현
> 커밋 단위: 1개. 별도 crate, 기존 코드에 영향 없음.

1. `relay-server/` crate 생성 (axum + tokio-tungstenite)
2. challenge/response 인증 구현
3. 메시지 라우팅 (sender_peer_id 첨부)
4. 오프라인 큐 (SQLite)
5. ACK 전달, dedupe
6. Presence 알림
7. 단일 세션 정책 (중복 연결 대체)
8. 통합 테스트: 2개 클라이언트 연결 → 인증 → 메시지 교환 → ACK → 오프라인 큐 → presence

### Phase 3: 클라이언트 relay_client.rs 구현
> 커밋 단위: 1개. 기존 libp2p 코드와 병행 가능.

1. `src-tauri/src/p2p/relay_client.rs` 생성
2. WS 연결 관리 (연결, 재연결 with 지수 백오프, heartbeat)
3. challenge/response 인증 핸들링
4. EncryptedEnvelope 송신 (crypto.rs로 암호화 → WS 전송)
5. EncryptedEnvelope 수신 (WS 수신 → sender_peer_id로 공개키 조회 → 복호화 → secretary.rs 전달)
6. ACK 처리 (outbox 상태 업데이트)
7. Presence 이벤트 수신 및 상태 갱신
8. 단위 테스트: mock WS 서버와의 연결/인증/송수신

### Phase 4: manager 교체 + envelope 변경
> 커밋 단위: 1개. 핵심 교체 단계.

1. `envelope.rs` 수정:
   - `Payload::Handshake` variant 제거
   - `EncryptedEnvelope` 래퍼는 shared/ crate에서 import
2. `manager/mod.rs` 재작성: P2PManager → RelayManager
   - `start()`: WS 연결 시작
   - `stop()`: WS 연결 종료
   - `status()`: relay 연결 상태 반환
   - `send_message()`: relay_client를 통해 전송 (**per-peer auth gating 제거** — 상대 오프라인이어도 전송)
   - `known_peers`: contacts DB에서 로드 (현행 유지)
   - `peer_presence`: relay presence 이벤트에서 갱신
3. `manager/event_loop.rs` 삭제 → relay_client.rs의 WS 수신 루프로 대체
4. `manager/helpers.rs` 삭제 → Introduction 메시지를 통한 auto-registration은 secretary.rs에서 처리
5. `transport.rs`, `protocol.rs` 삭제
6. `security.rs` 삭제 (crypto.rs + 서버 challenge/response로 대체)
7. `secretary.rs` 수정: `handle_incoming_message()`에 `sender_peer_id` 파라미터 추가, Introduce 처리 시 미등록 피어 허용 + 공개키 저장
8. outbox retry 경로 수정: `raw_envelope`에서 EncryptedEnvelope를 읽어 재전송 (재암호화 불필요 — 이미 암호화된 상태)
9. **업그레이드 시 기존 outbox 처리**: Phase 4 전환 시점에 outbox에 남아있는 평문 `Envelope` 형식의 pending 메시지를 처리하는 마이그레이션 단계 추가:
   - outbox에서 status="pending" 행 조회
   - 각 행의 `raw_envelope`을 EncryptedEnvelope로 재암호화
   - 실패 시 (공개키 미보유 등) 해당 행을 status="failed"로 표시
   - 이를 Phase 4 첫 시작(`RelayManager::start()`) 시 1회 실행
9. approval response 경로 수정: 응답 메시지도 EncryptedEnvelope로 암호화하여 `raw_envelope`에 저장

### Phase 5: 명령/UI 업데이트
> 커밋 단위: 1개.

**lib.rs 변경:**
- `P2PManager::new()` → `RelayManager::new()` (L75-78)
- `NodeIdentity` 초기화는 유지

**p2p_commands.rs 변경:**
- 제거: `p2p_get_listen_port`, `p2p_set_listen_port`, `p2p_dial_peer`
- 추가: `p2p_get_relay_url`, `p2p_set_relay_url`
- 수정: `p2p_get_connection_info` → relay 연결 상태 + presence 정보 반환
- 수정: `p2p_accept_invite` → multiaddr 파싱/PeerId 파싱 제거, peer_id + 공개키만 저장, `peer_id`↔`public_key` 일관성 검증 추가
- 수정: `p2p_send_message` → per-peer auth gating 제거, relay 연결 확인만
- 수정: `p2p_approve_message` → per-peer auth gating 제거

**contact_card.rs 변경:**
- `version: u32` 필드 추가 (v1 = libp2p, v2 = relay)
- v2: `addresses` 필드를 `Option<Vec<String>>`으로 변경 (None이면 relay 전용)
- `verify()` 시 `peer_id`↔`public_key` 일관성 검증 추가
- **SignableContent 확장**: `version`, `relay_url` 필드를 서명 대상(`SignableContent`)에 포함. 미포함 시 중간자가 relay_url을 변조하여 악성 서버로 유도 가능 (contact_card.rs의 서명은 명시적 allowlist이므로 필드 추가 시 반드시 SignableContent에도 추가)
- v1 초대코드도 파싱 가능 (하위 호환): `version` 필드에 `#[serde(default)]` 적용 (없으면 0 = v1), `addresses`에 `#[serde(default)]` 적용 (없으면 빈 Vec)
- 롤백 시 v1 파서 호환: v2 초대에 `addresses` 필드를 빈 배열로 포함 (필드 자체는 존재) → 구버전 파서가 에러 없이 파싱
- **v2 초대에 relay_url 포함**: `relay_url: Option<String>` 필드 추가. 수신자가 동일 relay 서버에 접속하도록 보장. 초기에는 단일 글로벌 relay지만, 향후 다중 relay 시 초대코드에 명시된 relay로 접속.
- **기존 연락처의 relay 수렴**: 기존 연락처(v1)는 글로벌 relay 설정을 사용. 양쪽이 동일한 글로벌 relay를 설정해야 자동 전환 가능. 초기에는 기본 relay URL을 앱에 하드코딩하여 보장.

**프론트엔드 변경:**
- `InviteDialog.tsx`: "수동 주소 추가" UI 제거
- `ContactDetail.tsx`: multiaddr 표시 → presence 기반 온라인/오프라인 상태 표시
- `NetworkSettingsPanel.tsx`: listen-port → relay URL 설정
- `networkStore.ts`: listen_port/addresses → relay_url/connection_status/peer_presence_map
- `PeerThread.tsx`: 피어 온라인 상태를 presence 이벤트 기반으로 변경
- `p2pCommands.ts`: Contact 인터페이스에서 addresses 제거, relay_url 관련 API 추가

### Phase 6: 정리 및 테스트
> 커밋 단위: 1개.

1. libp2p 관련 Cargo.toml 의존성 제거 (`libp2p`)
2. `src-tauri/src/bin/p2p_peer.rs` 삭제 또는 relay 테스트 클라이언트로 재작성
3. 기존 P2P 테스트 중 transport-dependent 테스트 제거, relay 기반 테스트로 교체
4. 통합 테스트: 릴레이 서버 + 2개 클라이언트 → 전체 시나리오 검증
5. verify.sh 업데이트: libp2p import 잔존 검사 추가
6. CI 파이프라인: relay-server 빌드/테스트 추가

### 테스트 매트릭스
| 시나리오 | 검증 항목 |
|---------|----------|
| 키 생성/저장 | Ed25519 키 → X25519 변환 정상, 라운드트립 |
| 초대 라운드트립 | v2 초대 생성 → 코드 교환 → 수용 → 연락처 저장 → peer_id↔public_key 검증 |
| v1 초대 하위호환 | v1(libp2p) 초대코드 파싱 가능, addresses 필드 무시 |
| Introduction | 초대 수용 → Introduce 메시지 전송 → 초대자 측 pending_approval 등록 |
| 메시지 송수신 | 암호화 → WS 전송 → 서버 라우팅(sender_peer_id 첨부) → 복호화 → secretary 처리 |
| ACK 전달 | 메시지 수신 → ACK → 발신자 delivery_state 업데이트 |
| 오프라인 큐 | 수신자 오프라인 → 서버 queued 응답 → 수신자 접속 → 메시지 전달 |
| 재연결 | WS 끊김 → 자동 재연결 (지수 백오프) → 큐 drain |
| 승인 플로우 | pending 메시지 → 사용자 승인/거부 → 응답 전송 |
| capability 체크 | 권한 없는 피어의 요청 거부 |
| E2E 암호화 검증 | 서버 DB에 저장된 오프라인 메시지가 암호문인지 확인 |
| Presence | 피어 접속 → online 이벤트 → 피어 해제 → offline 이벤트 + last_seen |
| 서버 인증 보안 | 리플레이 공격 시도 → 거부 확인, 잘못된 서명 → 거부 확인 |

---

## 연락처 호환성 규칙

### Cohort별 처리
| Cohort | 설명 | 처리 |
|--------|------|------|
| **기존 연락처 (양쪽 업데이트)** | 양쪽 모두 relay 버전 사용 | peer_id + 공개키가 동일하므로 자동 전환. 재초대 불필요. relay 접속 시 서로의 presence 수신. |
| **기존 연락처 (한쪽만 업데이트)** | 한쪽은 libp2p, 한쪽은 relay | 통신 불가. 양쪽 모두 업데이트될 때까지 대기. 이전 버전 사용자에게 업데이트 안내 UI 표시. |
| **신규 연락처 (relay)** | 마이그레이션 후 추가된 연락처 | v2 초대코드 사용. `addresses_json` 비어있음. relay 전용. |
| **롤백 후** | libp2p로 복귀 시 | 기존 연락처: `addresses_json` 유효하면 재연결 가능. 신규(relay-only) 연락처: 재초대 필요. |

### 단절적 변경 선언
이 마이그레이션은 **네트워크 프로토콜의 단절적 변경(breaking change)**이다.
- libp2p ↔ relay 간 호환 불가 (dual-stack 미지원)
- 모든 사용자가 동시에 업데이트해야 기존 연락처가 작동
- 소규모 사용자 기반이므로 동시 업데이트 조율 가능

---

## 롤백 전략

### 코드 롤백
- `p2p-legacy` 브랜치에서 libp2p 코드 완전 복원 가능
- Phase별 커밋 분리로 부분 롤백 가능
- Phase 1-2는 기존 코드에 영향 없으므로 독립 롤백 가능

### 데이터 롤백
- contacts 테이블: `addresses_json` 기존 데이터 유지 (신규 컬럼 추가 없음) → libp2p 복원 시 그대로 사용 가능
- `contact_card.rs`의 version 필드: v1 파서가 v2 필드를 무시하도록 구현
- peer_messages: `raw_envelope`에 EncryptedEnvelope 포맷이 저장되나, 롤백 시 기존 평문 메시지는 읽기 가능, 암호화 메시지는 읽기 불가 (graceful degradation)
- outbox: 스키마 변경 없음

### 롤백 시 연락처 상태
- libp2p 시절 연락처: `addresses_json`이 유효하므로 재연결 가능
- relay 시절 신규 연락처: `addresses_json`이 비어있으므로 재초대 필요

---

## 리스크

### 1. 서버 운영 부담 (중)
- **위험**: 릴레이 서버가 SPOF가 됨
- **완화**: Fly.io 자동 재시작, 헬스체크, 단일 바이너리 배포로 최소 관리
- **향후**: 다중 릴레이 서버 지원 (클라이언트가 복수 URL 설정)

### 2. E2E 암호화 구현 복잡도 (중)
- **위험**: 암호화 구현 오류 시 보안 취약점
- **완화**: 검증된 라이브러리(dalek, chacha20poly1305) 사용, 라운드트립 테스트, 서버 DB에 저장된 메시지 암호문 검증
- **범위 제한**: 초기에는 정적 DH만 구현, ratchet은 향후 추가

### 3. 단절적 네트워크 변경 (중)
- **위험**: libp2p ↔ relay 간 호환 불가
- **완화**: 소규모 사용자 기반이므로 동시 업데이트 조율. 업데이트 안내 UI 추가.

### 4. WS 연결 안정성 (낮음)
- **위험**: 장시간 WS 연결 유지 실패
- **완화**: heartbeat (30초 간격 ping/pong) + 자동 재연결 (지수 백오프, max 5분)

### 5. 영향 범위 과소평가 (낮음)
- **위험**: p2p_commands.rs, lib.rs, 프론트엔드 등 수정 범위가 예상보다 넓음
- **완화**: 영향받는 파일 전체 목록을 위 "코드 파일별 처분 계획"에 명시. Phase 5에서 일괄 처리.

## Scope Exclusions
- **LAN 디스커버리**: mDNS 없이도 릴레이 서버를 통해 연결. 향후 로컬 최적화 필요 시 별도 검토
- **다중 릴레이 서버**: 초기에는 단일 서버. 향후 복수 서버 지원 추가
- **키 ratchet**: 초기에는 정적 DH. 향후 Double Ratchet 추가 검토
- **서버 관리 UI**: 초기에는 설정 파일/환경변수로 관리
- **Dual-stack (libp2p + relay)**: 구현하지 않음. 단절적 전환.
