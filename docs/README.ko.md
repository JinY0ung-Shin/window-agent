# Window Agent

[English](../README.md)

AI 에이전트 기반 데스크톱 어시스턴트. 여러 에이전트를 생성하고, 브라우저 자동화를 수행하며, 릴레이 네트워크를 통해 에이전트 간 통신을 지원합니다.

## 프로젝트 구조

```
window-agent/
├── src/                  # 프론트엔드 (React + TypeScript)
├── src-tauri/            # 백엔드 (Tauri + Rust)
├── relay-server/         # 릴레이 서버 (Rust, 독립 실행)
├── shared/               # 클라이언트-서버 공유 프로토콜
└── browser-sidecar/      # 브라우저 자동화 (Playwright)
```

## 사전 요구사항

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- 시스템 의존성 (Linux):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```

## 설치 및 실행

### 데스크톱 앱

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run tauri dev

# 프로덕션 빌드
npm run tauri build
```

### 릴레이 서버

에이전트 간 통신을 위한 WebSocket 릴레이 서버입니다. 데스크톱 앱과 별도로 실행합니다.

```bash
cd relay-server
cargo run
```

환경 변수:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `LISTEN_ADDR` | `0.0.0.0:8080` | 바인드 주소 |
| `DATABASE_URL` | `sqlite:relay.db?mode=rwc` | SQLite 경로 |
| `RUST_LOG` | - | 로그 레벨 (예: `info`, `debug`) |

데스크톱 앱의 설정 > 네트워크 탭에서 릴레이 서버 URL을 `ws://주소:8080`으로 설정하면 연결됩니다.

## 테스트

```bash
# 프론트엔드 테스트
npm test

# Rust 테스트 (백엔드 + 릴레이 서버)
cargo test --workspace
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 19, TypeScript, Zustand, i18next |
| 백엔드 | Tauri 2, Rust, SQLite |
| 릴레이 서버 | Axum, Tokio, SQLite |
| 브라우저 자동화 | Playwright (Chromium) |
| 에이전트 통신 | WebSocket, Ed25519 인증, X25519 암호화 |
