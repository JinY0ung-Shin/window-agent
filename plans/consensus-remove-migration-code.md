# Remove Legacy Migration Code (v3)

## Goal
레거시 마이그레이션 코드를 제거하고 DB 스키마를 단일 초기화로 단순화한다.

## Decisions (Codex Review Round 1+2 피드백 반영)

1. **기존 DB 호환성**: `Database::new()`에서 DB 열기 전에 스키마 버전 확인. 불일치 시 DB 파일 삭제 후 재오픈. `new_in_memory()`는 항상 새 DB이므로 bypass.
2. **TOOLS.md 지원**: 완전 제거. allowlist, export/import persona 목록에서도 제거
3. **memory_notes.json import/export**: 완전 제거. Vault 포맷만 지원
4. **to_legacy_json()**: `tool_commands.rs`, `chat_commands.rs`, `export_commands.rs` 3곳 모두 처리
5. **labels.ts**: `importResult()` 시그니처에서 notes 파라미터 제거

## Changes

### Wave 1: vault/migration.rs 제거 (독립)

**파일 삭제:**
- `src-tauri/src/vault/migration.rs`

**파일 수정:**
- `src-tauri/src/vault/mod.rs`:
  - `pub mod migration;` 줄 삭제
  - `find_by_legacy_id()` 메서드 삭제
- `src-tauri/src/commands/vault_commands.rs`:
  - `vault_migrate_preview`, `vault_migrate_execute` 커맨드 삭제
  - `use crate::vault::migration::{MigrationPreview, MigrationResult};` import 삭제
- `src-tauri/src/lib.rs`:
  - `commands::vault_migrate_preview`, `commands::vault_migrate_execute` 등록 삭제
- `src/services/commands/vaultCommands.ts`:
  - `vaultMigratePreview`, `vaultMigrateExecute` 함수 삭제 + Migration 섹션 주석 삭제
- `src/services/vaultTypes.ts`:
  - `MigrationPreview`, `MigrationResult` 인터페이스 삭제 (line 110-122)

### Wave 2: utils/tool_migration.rs + TOOLS.md 참조 제거 (독립)

**파일 삭제:**
- `src-tauri/src/utils/tool_migration.rs`

**파일 수정:**
- `src-tauri/src/utils/mod.rs`:
  - `pub mod tool_migration;` 줄 삭제
- `src-tauri/src/commands/agent_commands.rs`:
  - `use crate::utils::tool_migration::ensure_tool_config;` import 삭제
  - `sync_agents_from_fs()` 내 `ensure_tool_config` 호출 삭제 (line ~211)
  - `seed_manager_agent()` 내 `ensure_tool_config` 호출 삭제 (line ~247)
  - 테스트에서 `TOOLS.md`, `TOOLS_LEGACY.md` 참조 삭제 (line ~754)
- `src-tauri/src/commands/export_commands.rs`:
  - `use crate::utils::tool_migration::ensure_tool_config;` import 삭제
  - persona_files 배열에서 `"TOOLS.md"`, `"TOOLS_LEGACY.md"` 제거 (export line ~86, import line ~276)
  - import 후 `ensure_tool_config` 호출 삭제 (line ~685-688)
- `src-tauri/src/utils/path_security.rs`:
  - `ALLOWED_AGENT_FILES`에서 `"TOOLS.md"`, `"TOOLS_LEGACY.md"` 제거
  - 테스트 수정 (line 240: `TOOLS.md` → `TOOL_CONFIG.json`)

### Wave 3: memory_notes + to_legacy_json 완전 제거 (Wave 1, 2 후)

**Rust 백엔드:**
- `src-tauri/src/db/models.rs`:
  - `MemoryNote` struct 삭제
- `src-tauri/src/db/operations.rs`:
  - `list_memory_notes_impl` 함수 삭제
  - `MemoryNote` import 삭제
- `src-tauri/src/vault/mod.rs`:
  - `to_legacy_json()` 메서드 삭제
  - `create_note_preserving_id()` 메서드 삭제
  - `strip_title_heading()` pub 함수 — chat_commands.rs + tool_commands.rs에서 사용 중이므로 **유지**
  - `test_to_legacy_json` 테스트 삭제
- `src-tauri/src/commands/chat_commands.rs`:
  - `list_memory_notes` — `to_legacy_json` 대신 `list_notes` + `strip_title_heading`으로 직접 매핑
- `src-tauri/src/commands/tool_commands.rs`:
  - `memory_note` tool의 `"read"` action (id 없는 경우) — `to_legacy_json` 대신 `list_notes` + 직접 매핑
- `src-tauri/src/commands/export_commands.rs`:
  - Export: `memory_notes.json` backward-compat 생성 로직 삭제 (line ~132-184)
  - Import: `memory_notes.json` 파싱 삭제 (line ~322-336)
  - Import: legacy memory_notes → vault 변환 + DB fallback 삭제 (line ~569-611)
  - `ImportResult.memory_notes_imported` 필드 삭제 (line ~43)
  - `MemoryNote` 관련 import 삭제
  - `list_memory_notes_impl` import 삭제
- `src-tauri/src/db/schema.rs`:
  - 테스트에서 `memory_notes` 테이블 확인 assertion 삭제

**프론트엔드:**
- `src/services/commands/agentCommands.ts`:
  - `ImportResult` 타입에서 `memory_notes_imported` 필드 삭제
- `src/components/settings/ExportSection.tsx`:
  - `memory_notes_imported` 사용 제거
- `src/labels.ts`:
  - `importResult()` 시그니처에서 `notes` 파라미터 제거 (line 78)
  - 두 테마 구현 모두 업데이트 (line ~199, ~320)

### Wave 4: DB 마이그레이션 단순화 (Wave 3 후)

**`src-tauri/src/db/migrations.rs` 완전 리팩토링:**
- `Migration` struct, `all_migrations()`, `_migrations` 테이블, 버전 관리 로직 전부 삭제
- 커스텀 마이그레이션 함수 7개 전부 삭제
- 새로운 `ensure_schema()` 함수: 최종 스키마 CREATE TABLE IF NOT EXISTS
- 테스트 전면 재작성

**DB 호환성 — 구체적 구현 (`Database::new()`):**
```rust
pub fn new(db_path: &str) -> Result<Self, rusqlite::Error> {
    // 1. DB 파일이 존재하면 임시로 열어서 스키마 버전 확인
    if Path::new(db_path).exists() {
        let probe = Connection::open(db_path)?;
        let needs_reset = match probe.query_row(
            "SELECT version FROM _schema_version LIMIT 1",
            [], |row| row.get::<_, i64>(0),
        ) {
            Ok(v) if v == SCHEMA_VERSION => false,
            _ => true,  // 테이블 없거나 버전 불일치
        };
        drop(probe);  // 연결 해제

        if needs_reset {
            eprintln!("Schema mismatch, recreating DB");
            std::fs::remove_file(db_path)?;
        }
    }

    // 2. (재생성된 또는 신규) DB 열기 + 스키마 초기화
    let conn = Connection::open(db_path)?;
    schema::initialize(&conn)?;
    Ok(Database { conn: Mutex::new(conn) })
}
```
- `new_in_memory()`: 항상 새 DB이므로 버전 확인 불필요, 기존 로직 유지

**최종 스키마 (9개 테이블, memory_notes 제거):**
1. agents
2. conversations (agent_id FK, summary, active_skills)
3. messages (conversation_id FK, tool columns)
4. tool_call_logs (conversation_id FK, artifact_id)
5. browser_artifacts (conversation_id FK, screenshot_path)
6. contacts (P2P, addresses_json)
7. peer_threads (contact_id FK)
8. peer_messages (thread_id FK)
9. outbox (peer_message_id FK)
+ `_schema_version` (버전 트래킹)

**`src-tauri/src/db/schema.rs`:**
- `migrations::run_migrations(conn)` → `migrations::ensure_schema(conn)` 호출 변경

### Wave 5: 프론트엔드 정리 + 빌드 검증

- `src/stores/__tests__/chatStore.test.ts`: vaultMigrate 관련 참조 제거
- `cargo test` — Rust 전체 통과
- `cargo build` — 컴파일 에러 없음
- 프론트엔드 빌드 확인

## Testing Strategy
- `cargo test` — 모든 Rust 테스트 통과
- `cargo build` — 컴파일 에러 없음
- 프론트엔드 타입 에러 없음

## Risk
- 기존 DB를 가진 사용자: DB 자동 재생성 (데이터 손실, 초기 단계라 수용 가능)
- 레거시 ZIP 아카이브 import: memory_notes.json만 있는 옛 아카이브는 메모리 없이 import됨
