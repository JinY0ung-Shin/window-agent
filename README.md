# Window Agent

[한국어](docs/README.ko.md)

AI agent-powered desktop assistant. Create multiple agents, automate browsers, and enable inter-agent communication through a relay network.

## Project Structure

```
window-agent/
├── src/                  # Frontend (React + TypeScript)
├── src-tauri/            # Backend (Tauri + Rust)
├── relay-server/         # Relay server (Rust, standalone)
├── shared/               # Shared client-server protocol
└── browser-sidecar/      # Browser automation (Playwright)
```

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- System dependencies (Linux):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```

## Getting Started

### Desktop App

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Production build
npm run tauri build
```

### Relay Server

A WebSocket relay server for inter-agent communication. Run separately from the desktop app.

```bash
cd relay-server
cargo run
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTEN_ADDR` | `0.0.0.0:8080` | Bind address |
| `DATABASE_URL` | `sqlite:relay.db?mode=rwc` | SQLite path |
| `RUST_LOG` | - | Log level (e.g. `info`, `debug`) |

Set the relay server URL to `ws://address:8080/ws` in Settings > Network tab to connect.

## Testing

```bash
# Frontend tests
npm test

# Rust tests (backend + relay server)
cargo test --workspace
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Zustand, i18next |
| Backend | Tauri 2, Rust, SQLite |
| Relay Server | Axum, Tokio, SQLite |
| Browser Automation | Playwright (Chromium) |
| Agent Communication | WebSocket, Ed25519 auth, X25519 encryption |
