# Obsidian 기반 에이전트 메모리 시스템 설계 문서

> **Status**: Approved v3.1
> **Author**: Claude (designer)
> **Date**: 2026-03-17
> **Review**: Round 1 (5.1) → Round 2 (7.2) → Round 3 (7.6) → **Round 4 (8.4) PASS**

---

## 1. 개요

### 1.1 문제 정의

현재 Window Agent의 메모리 시스템은 SQLite `memory_notes` 테이블에 flat한 텍스트 노트를 저장한다:

- 메모리 간 **관계(relationship)**를 표현할 수 없음
- 에이전트 간 **지식 공유**가 불가능
- 사용자가 메모리를 **탐색/편집/시각화**하기 어려움
- 메모리의 **컨텍스트**와 **시간적 변화**를 추적할 수 없음

### 1.2 현재 시스템 분석 (마이그레이션 기준선)

마이그레이션의 정확한 범위를 정의하기 위해, 현재 시스템의 터치포인트를 명시한다:

| 계층 | 현재 구현 | 파일 참조 |
|------|-----------|-----------|
| **DB 스키마** | `memory_notes` 테이블: `id, agent_id, title, content, created_at, updated_at` | `src-tauri/src/db/operations.rs:290-395` |
| **Rust 커맨드** | `create_memory_note`, `list_memory_notes`, `update_memory_note`, `delete_memory_note` | `src-tauri/src/lib.rs:80-83` |
| **TS 커맨드 래퍼** | `memoryCommands.ts` — 4개 CRUD 함수 | `src/services/commands/memoryCommands.ts:1-18` |
| **Zustand Store** | `memoryStore.ts` — `notes[]` + `loadNotes(agentId)` + CRUD actions | `src/stores/memoryStore.ts:5-46` |
| **프롬프트 주입** | `buildMemorySection()` — 최신순 정렬, 500 토큰 예산, `[MEMORY NOTES]` 블록 | `src/services/chatHelpers.ts:108-167` |
| **에이전트 Tool** | 단일 `memory_note` tool (action: create/read/update/delete) | `src-tauri/resources/default-agent/TOOLS.md:28-35` |
| **Tool 실행** | `tool_commands.rs` — `agent_id` 자동 주입 후 DB CRUD 호출 | `src-tauri/src/commands/tool_commands.rs:355-410` |
| **Tool 권한** | `TOOL_CONFIG.json` — `memory_note` 단일 항목 | `src-tauri/resources/default-agent/TOOL_CONFIG.json:4` |
| **Export/Import** | `memory_notes.json`으로 직렬화, import 시 트랜잭션 복원 | `src-tauri/src/commands/export_commands.rs:151-160, 264-402` |
| **UI** | `MemoryBar.tsx` — 접이식 사이드바, 에이전트별 노트 리스트 | `src/components/memory/MemoryBar.tsx` |
| **대화 연동** | `conversationStore` — 에이전트/대화 선택 시 해당 에이전트 노트 로드 | `src/stores/conversationStore.ts:71-79, 144-153` |

### 1.3 제안

각 에이전트의 메모리를 **Obsidian Vault** 형식의 Markdown 파일로 관리하고, `[[wikilink]]` 기반 양방향 링크로 메모리 간 관계를 형성한다. 사용자는 Obsidian 앱이나 Window Agent 내장 뷰를 통해 에이전트의 지식 그래프를 탐색할 수 있다.

### 1.4 핵심 원칙

1. **ID-first 설계**: 모든 공개 API는 UUID 기반 — 파일 경로는 내부 구현 상세
2. **무중단 마이그레이션**: SQLite를 read-only 폴백으로 유지하며, vault가 완전히 검증될 때까지 공존
3. **파일 시스템 기반**: 모든 메모리는 Markdown 파일 — Obsidian 없이도 읽기/편집 가능
4. **에이전트 자율성**: 각 에이전트가 자신의 메모리를 독립적으로 관리
5. **연결 우선**: wikilink를 통해 메모리 간 관계가 자연스럽게 형성
6. **사용자 투명성**: 사용자가 언제든 메모리를 직접 확인, 수정, 삭제 가능

---

## 2. 아키텍처

### 2.1 Vault 디렉토리 구조

```
<app_data>/vault/
├── .obsidian/                    # Obsidian 설정 (graph 색상, 플러그인 등)
│   ├── app.json
│   ├── graph.json                # 그래프 뷰 설정 (에이전트별 색상)
│   └── workspace.json
│
├── agents/                       # 에이전트별 메모리 공간
│   ├── <agent_folder_name>/      # e.g., "manager", "researcher"
│   │   ├── _index.md             # 에이전트 프로필 + 메모리 목록
│   │   ├── knowledge/            # 학습한 지식
│   │   ├── conversations/        # 대화에서 추출한 핵심 정보
│   │   ├── decisions/            # 의사결정 기록
│   │   └── reflections/          # 자기 성찰 / 피드백 학습
│   │
│   └── <another_agent>/
│       └── ...
│
├── shared/                       # 에이전트 간 공유 지식 (소유 모델: 섹션 3.6)
│   ├── project/                  # 프로젝트 컨텍스트
│   ├── people/                   # 사용자/팀원 정보
│   ├── incidents/                # 사건/장애 기록
│   └── glossary/                 # 용어 사전
│
└── templates/                    # 메모리 노트 템플릿
    ├── knowledge.md
    ├── conversation-summary.md
    ├── decision.md
    └── reflection.md
```

### 2.2 시스템 구성도

```
┌──────────────────────────────────────────────────────────┐
│                     Frontend (React)                      │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ MemoryGraph  │  │ MemoryPanel  │  │ MemorySearch │    │
│  │ (D3/Force)   │  │ (List+Edit)  │  │ (Full-text)  │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         └────────┬─────────┴──────────────────┘            │
│                  │                                          │
│          ┌───────▼────────┐                                │
│          │   vaultStore    │  (Zustand)                     │
│          └───────┬────────┘                                │
│                  │                                          │
│          ┌───────▼────────┐                                │
│          │  MemoryAdapter  │  ← 기존 memoryStore 호환 shim  │
│          └───────┬────────┘                                │
└──────────────────┼─────────────────────────────────────────┘
                   │ Tauri Commands (ID-based)
┌──────────────────┼─────────────────────────────────────────┐
│                  │       Backend (Rust)                      │
│          ┌───────▼────────┐                                │
│          │  VaultManager   │                                │
│          │  (single source │                                │
│          │   of truth)     │                                │
│          └───────┬────────┘                                │
│                  │                                          │
│     ┌────────────┼─────────────┬──────────────┐           │
│     │            │             │              │           │
│  ┌──▼──┐  ┌─────▼─────┐  ┌───▼───┐  ┌───────▼────────┐  │
│  │FS   │  │ LinkIndex  │  │Search │  │ VaultWatcher   │  │
│  │(MD) │  │ (in-memory)│  │       │  │ (notify crate) │  │
│  └─────┘  └───────────┘  └───────┘  └────────────────┘  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │ SQLite (Phase 1-2: read-only 롤백 안전망)          │   │
│  │  - 마이그레이션 전 데이터 보존                       │   │
│  │  - Phase 4에서 drop                                 │   │
│  └────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
                   │
                   ▼ (File System)
          ┌─────────────────┐
          │  Obsidian Vault  │◄──── 사용자: Obsidian 앱 또는
          │  (Markdown files)│      내장 UI로 탐색/편집
          └─────────────────┘
```

---

## 3. 데이터 모델

### 3.1 메모리 노트 형식

```markdown
---
id: "550e8400-e29b-41d4-a716-446655440000"
agent: "manager"
type: "knowledge"
tags: ["auth", "security"]
confidence: 0.9
created: "2026-03-17T14:30:00+09:00"
updated: "2026-03-17T14:30:00+09:00"
revision: "sha256-hex-first-8-chars"
source: "conversation:conv-uuid"
aliases: ["인증 미들웨어", "auth middleware"]
legacy_id: "old-sqlite-id"
---

# 인증 미들웨어 리라이트 이유

법무팀이 세션 토큰 저장 방식에 대한 컴플라이언스 이슈를 제기했다.
기술 부채 정리가 아니라 **법적 요구사항** 기반의 작업이다.

## 관련 정보
- 원래 이슈: [[incidents/2026-01-session-token-audit]]
- 프로젝트 결정: [[shared/project/auth-rewrite-plan]]
```

### 3.2 ID-first 설계 (v1 피드백 반영)

v1에서 API가 `note_path` 기반이었던 문제를 해결한다. Obsidian에서 파일명을 변경하거나 이동해도 참조가 깨지지 않아야 한다.

**규칙:**
- 모든 **공개 API** (Tauri 커맨드, 에이전트 Tool)는 `note_id: UUID`를 사용
- **파일 경로**는 VaultManager 내부에서 `id → path` 맵으로 관리
- Wikilink는 `[[id|표시텍스트]]` 또는 `[[파일명]]` 두 형태 모두 지원
- ID→path 맵은 frontmatter의 `id` 필드에서 빌드 (앱 시작 시 + watcher 갱신 시)

```rust
struct NoteRegistry {
    /// UUID → 파일 시스템 경로
    id_to_path: HashMap<String, PathBuf>,
    /// 파일 경로 → UUID (역방향 조회)
    path_to_id: HashMap<PathBuf, String>,
    /// 파일명(stem) → UUID 목록 (wikilink 해석용, 동명 파일 가능)
    name_to_ids: HashMap<String, Vec<String>>,
}
```

### 3.3 Wikilink 규칙

| 형태 | 의미 | 예시 |
|------|------|------|
| `[[filename]]` | 파일명으로 참조 (NoteRegistry.name_to_ids로 해석) | `[[user-prefers-korean]]` |
| `[[id\|표시텍스트]]` | UUID로 참조 (안정적, 리팩토링 안전) | `[[550e8400\|기술 스택]]` |
| `#tag` | 인라인 태그 | `#auth #security` |

에이전트가 생성하는 wikilink는 항상 `[[id|표시텍스트]]` 형태를 사용하도록 Tool 레벨에서 강제한다. 사용자가 Obsidian에서 직접 `[[filename]]` 형태로 작성하는 것도 허용한다.

### 3.6 Shared 지식 소유 모델

`shared/` 폴더의 노트는 특정 에이전트에 귀속되지 않는 공유 지식이다.

**소유권 규칙:**

| 항목 | 규칙 |
|------|------|
| **생성** | 에이전트가 `memory_note` tool에 `scope: "shared"`를 지정하여 생성. `agent` 필드에는 생성자 ID를 기록하되 소유권이 아닌 출처(provenance)로만 사용. |
| **읽기** | 모든 에이전트가 `shared/` 전체를 읽기 가능 |
| **수정** | 어떤 에이전트든 수정 가능. frontmatter에 `last_edited_by` 필드 추가. |
| **삭제** | 사용자만 가능. 에이전트는 shared 노트를 삭제할 수 없음 (실수 방지). |
| **Export** | 에이전트 export 시 해당 에이전트가 참조하는 shared 노트만 포함 (전체 shared 복사 아님) |
| **Import** | shared 노트는 `id` 기준 dedup: 이미 존재하면 skip, 없으면 생성 |

**API 확장:**

```rust
#[tauri::command]
async fn vault_create_note(
    agent_id: String,
    scope: Option<String>,      // "agent" (default) | "shared"
    category: String,
    title: String,
    content: String,
    tags: Vec<String>,
    related_ids: Vec<String>,
) -> Result<VaultNote, String>;
```

`scope: "shared"`일 때 파일은 `shared/<category>/` 아래에 생성된다.

**Frontmatter 차이:**

```yaml
# shared/ 노트의 frontmatter
---
id: "uuid"
agent: "manager"              # 생성자 (출처, 소유권 아님)
last_edited_by: "researcher"  # 마지막 수정자
type: "knowledge"
scope: "shared"               # agent 노트에는 이 필드 없음 (기본값 agent)
tags: ["architecture"]
confidence: 0.9
created: "2026-03-17T14:30:00+09:00"
updated: "2026-03-17T14:30:00+09:00"
revision: "a1b2c3d4"
---
```

**Export 시 shared 노트 포함 로직:**

```rust
fn collect_shared_references(agent_id: &str, vault: &VaultManager) -> Vec<String> {
    let agent_notes = vault.list_notes(Some(agent_id), None, None);
    let mut shared_ids = HashSet::new();

    // Step 1: 에이전트 노트에서 직접 참조하는 shared 노트 수집
    for note in &agent_notes {
        for link in vault.get_outgoing_links(&note.id) {
            if link.resolved && vault.is_shared_note(&link.target_id) {
                shared_ids.insert(link.target_id.clone());
            }
        }
    }

    // Step 2: 수집된 shared 노트가 참조하는 다른 shared 노트 (depth 1)
    let direct_shared: Vec<String> = shared_ids.iter().cloned().collect();
    for shared_id in &direct_shared {
        for link in vault.get_outgoing_links(shared_id) {
            if link.resolved && vault.is_shared_note(&link.target_id) {
                shared_ids.insert(link.target_id.clone());
            }
        }
    }

    shared_ids.into_iter().collect()
}
```

### 3.4 링크 인덱스 구조 (in-memory)

```rust
struct LinkIndex {
    /// note_id → 이 노트가 참조하는 노트들
    outgoing: HashMap<String, Vec<LinkRef>>,
    /// note_id → 이 노트를 참조하는 노트들 (backlinks)
    incoming: HashMap<String, Vec<LinkRef>>,
    /// tag → 이 태그를 가진 노트들
    tag_index: HashMap<String, Vec<String>>,
}

struct LinkRef {
    source_id: String,
    target_id: String,       // 해석된 노트 UUID
    raw_link: String,        // 원본 wikilink 텍스트
    display_text: Option<String>,
    line_number: u32,
    resolved: bool,          // false면 broken link
}
```

### 3.5 그래프 데이터 모델

```typescript
interface GraphNode {
  id: string;          // UUID
  label: string;
  agent: string;
  type: NoteType;
  tags: string[];
  confidence: number;
  updatedAt: string;
}

interface GraphEdge {
  source: string;      // node UUID
  target: string;      // node UUID
  type: "wikilink" | "tag-cooccurrence";
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

---

## 4. 백엔드 구현 (Rust)

### 4.1 VaultManager 모듈

```
src-tauri/src/
├── vault/
│   ├── mod.rs            # VaultManager 메인 구조체 + NoteRegistry
│   ├── note.rs           # 노트 파싱/직렬화 (frontmatter + body)
│   ├── links.rs          # wikilink 파싱 + LinkIndex 관리
│   ├── search.rs         # 전문 검색
│   ├── graph.rs          # 그래프 데이터 생성
│   ├── watcher.rs        # 파일 변경 감지 (Phase 1부터 포함)
│   ├── security.rs       # vault 전용 경로 보안 정책
│   └── migration.rs      # SQLite → vault 마이그레이션 로직
```

### 4.2 Tauri Commands (ID-based)

```rust
// ===== 노트 CRUD (모두 UUID 기반) =====

#[tauri::command]
async fn vault_create_note(
    agent_id: String,
    scope: Option<String>,    // "agent" (default) | "shared" — shared/ 에 생성
    category: String,         // "knowledge" | "conversation" | "decision" | "reflection"
    title: String,
    content: String,
    tags: Vec<String>,
    related_ids: Vec<String>, // 연결할 다른 노트의 UUID
) -> Result<VaultNote, String>;
// scope이 "shared"이면 shared/<category>/ 아래에 생성, agent 필드에 생성자 기록

#[tauri::command]
async fn vault_read_note(note_id: String) -> Result<VaultNote, String>;

#[tauri::command]
async fn vault_update_note(
    note_id: String,
    caller_agent_id: String,   // last_edited_by 기록용
    content: Option<String>,
    tags: Option<Vec<String>>,
    confidence: Option<f64>,
    add_links: Option<Vec<String>>,
) -> Result<VaultNote, String>;
// shared 노트 수정 시 caller_agent_id를 last_edited_by에 기록

#[tauri::command]
async fn vault_delete_note(
    note_id: String,
    caller: String,            // "user" | agent_id — shared 노트는 "user"만 삭제 가능
) -> Result<(), String>;
// caller가 agent_id이고 대상이 shared 노트면 Err(SharedDeleteForbidden) 반환

#[tauri::command]
async fn vault_list_notes(
    agent_id: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Vec<VaultNoteSummary>, String>;

// ===== 검색 =====

#[tauri::command]
async fn vault_search(
    query: String,
    agent_id: Option<String>,
    scope: Option<String>,      // "self" | "shared" | "all"
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String>;

// ===== 그래프 =====

#[tauri::command]
async fn vault_get_graph(
    agent_id: Option<String>,
    depth: Option<u32>,
    include_shared: bool,
) -> Result<GraphData, String>;

// ===== 링크 (UUID 기반) =====

#[tauri::command]
async fn vault_get_backlinks(note_id: String) -> Result<Vec<LinkRef>, String>;

// ===== Vault 관리 =====

#[tauri::command]
async fn vault_get_path() -> Result<String, String>;

#[tauri::command]
async fn vault_open_in_obsidian() -> Result<(), String>;

#[tauri::command]
async fn vault_rebuild_index() -> Result<IndexStats, String>;

// ===== 마이그레이션 =====

#[tauri::command]
async fn vault_migrate_preview() -> Result<MigrationPreview, String>;

#[tauri::command]
async fn vault_migrate_execute() -> Result<MigrationResult, String>;

// ===== Export/Import (vault-aware) =====

#[tauri::command]
async fn vault_export_agent_memory(agent_id: String) -> Result<Vec<u8>, String>;

#[tauri::command]
async fn vault_import_agent_memory(agent_id: String, data: Vec<u8>) -> Result<ImportResult, String>;
```

### 4.3 파일 변경 감지 (Phase 1부터 포함)

Obsidian에서 사용자가 직접 메모리를 편집할 수 있으므로, 파일 시스템 변경 감지는 **첫 릴리스부터** 필요하다.

```rust
struct VaultWatcher {
    watcher: RecommendedWatcher,
    vault_path: PathBuf,
    debounce_ms: u64,            // 연속 변경 디바운싱 (300ms)
}

impl VaultWatcher {
    fn on_change(&self, event: notify::Event) {
        match event.kind {
            Create(_) | Modify(ModifyKind::Data(_)) => {
                // 1. 파일 읽기 + frontmatter 파싱
                // 2. NoteRegistry 갱신 (id↔path 맵)
                // 3. LinkIndex 갱신
                // 4. emit "vault:note-changed" { note_id } event to frontend
            }
            Modify(ModifyKind::Name(_)) => {
                // 파일 rename 감지
                // 1. 이전 경로의 path_to_id에서 UUID 조회
                // 2. id_to_path를 새 경로로 갱신
                // 3. wikilink [[filename]] 해석 재계산
                // 4. emit "vault:note-moved" event
            }
            Remove(_) => {
                // 1. NoteRegistry에서 제거
                // 2. LinkIndex에서 관련 엔트리 제거
                // 3. broken link 마킹 (참조하던 노트들)
                // 4. emit "vault:note-removed" event
            }
        }
    }
}
```

### 4.4 동시 접근 충돌 처리

Window Agent와 Obsidian이 동시에 같은 파일을 편집할 때의 충돌 처리 전략:

**Optimistic Concurrency (낙관적 동시성 제어):**

1. 각 노트의 frontmatter에 `revision` 필드 저장 (내용의 SHA-256 첫 8자)
2. Window Agent에서 노트를 수정할 때:
   - 파일 읽기 → 현재 revision 확인
   - 메모리에 캐시된 revision과 비교
   - **일치**: 정상 쓰기 + revision 갱신
   - **불일치**: 외부 수정 감지 → 충돌 처리
3. 충돌 처리 방식:
   - 충돌 복사본 생성: `filename.conflict-2026-03-17.md`
   - 프론트엔드에 `vault:conflict-detected` 이벤트 발행
   - 사용자가 UI에서 병합 또는 선택

```rust
enum WriteResult {
    Success { new_revision: String },
    Conflict {
        local_revision: String,
        disk_revision: String,
        conflict_copy_path: PathBuf,
    },
}

impl VaultManager {
    async fn write_note_safe(&self, note_id: &str, content: &str, expected_revision: &str)
        -> Result<WriteResult, VaultError>
    {
        let path = self.registry.resolve(note_id)?;
        let current = self.read_file_revision(&path)?;

        if current != expected_revision {
            // 충돌 — 복사본 생성 후 사용자에게 알림
            let conflict_path = self.create_conflict_copy(&path)?;
            return Ok(WriteResult::Conflict {
                local_revision: expected_revision.to_string(),
                disk_revision: current,
                conflict_copy_path: conflict_path,
            });
        }

        // 정상 쓰기
        let new_revision = self.write_and_hash(&path, content)?;
        Ok(WriteResult::Success { new_revision })
    }
}
```

### 4.5 Vault 전용 경로 보안 정책

기존 `path_security.rs`는 에이전트 persona 파일과 ZIP 엔트리에 특화되어 있으므로, vault 전용 보안 정책을 별도로 구현한다.

```rust
// src-tauri/src/vault/security.rs

struct VaultSecurity {
    vault_root: PathBuf,
}

impl VaultSecurity {
    /// 경로가 vault 루트 내부인지 검증 (symlink traversal 방지).
    /// 기존 파일과 아직 존재하지 않는 새 파일 모두 처리한다.
    /// 기존 codebase의 path_security.rs:89 패턴을 따름:
    /// 새 파일의 경우 부모 디렉토리를 canonicalize하여 검증.
    fn validate_within_vault(&self, path: &Path) -> Result<PathBuf, SecurityError> {
        let vault_canonical = self.vault_root.canonicalize()?;

        if path.exists() {
            // 기존 파일: 직접 canonicalize
            let canonical = path.canonicalize()?;
            if !canonical.starts_with(&vault_canonical) {
                return Err(SecurityError::PathEscape);
            }
            Ok(canonical)
        } else {
            // 새 파일 (create, rename, conflict-copy, migration 대상):
            // 부모 디렉토리를 canonicalize + 파일명을 덧붙여 검증
            let parent = path.parent().ok_or(SecurityError::InvalidPath)?;
            let filename = path.file_name().ok_or(SecurityError::InvalidPath)?;
            let parent_canonical = parent.canonicalize().map_err(|_| SecurityError::ParentNotFound)?;
            if !parent_canonical.starts_with(&vault_canonical) {
                return Err(SecurityError::PathEscape);
            }
            Ok(parent_canonical.join(filename))
        }
    }

    /// 파일명 새니타이징
    fn sanitize_filename(name: &str) -> Result<String, SecurityError> {
        // 금지: /, \, .., 제어 문자, null byte
        // 금지 접두사: . (hidden files, .obsidian 보호)
        // 최대 길이: 200자
        // 허용: 유니코드 문자, 숫자, -, _, space
        let sanitized = name
            .chars()
            .filter(|c| !c.is_control() && *c != '/' && *c != '\\' && *c != '\0')
            .collect::<String>();

        if sanitized.starts_with('.') || sanitized.contains("..") {
            return Err(SecurityError::InvalidFilename);
        }
        if sanitized.len() > 200 {
            return Err(SecurityError::FilenameTooLong);
        }
        Ok(sanitized)
    }

    /// 에이전트가 접근 가능한 경로인지 검증
    fn validate_agent_access(&self, agent_folder: &str, path: &Path) -> Result<(), SecurityError> {
        // 에이전트는 자신의 폴더 + shared/ 만 접근 가능
        let relative = path.strip_prefix(&self.vault_root)?;
        let first_component = relative.components().next();
        match first_component {
            Some(Component::Normal(name)) => {
                let name_str = name.to_str().unwrap_or("");
                if name_str == "agents" {
                    // agents/ 하위는 자신의 폴더만
                    let second = relative.components().nth(1);
                    if let Some(Component::Normal(agent_name)) = second {
                        if agent_name.to_str().unwrap_or("") != agent_folder {
                            return Err(SecurityError::CrossAgentAccess);
                        }
                    }
                } else if name_str == "shared" || name_str == "templates" {
                    // shared/와 templates/는 허용
                } else {
                    return Err(SecurityError::ForbiddenPath);
                }
                Ok(())
            }
            _ => Err(SecurityError::ForbiddenPath),
        }
    }
}
```

### 4.6 Wikilink 파서

```rust
fn parse_wikilinks(content: &str) -> Vec<WikiLink> {
    let re = Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap();
    re.captures_iter(content)
        .map(|cap| WikiLink {
            raw: cap[0].to_string(),
            target: cap[1].to_string(),
            display: cap.get(2).map(|m| m.as_str().to_string()),
        })
        .collect()
}

/// Wikilink 해석 — 결정적(deterministic) 해석 규칙으로 모호성을 제거한다.
///
/// 해석 우선순위 (위에서 아래로):
///   1. UUID 직접 매칭 (가장 높은 우선순위)
///   2. 파일명 유일 매칭 (이름이 하나뿐인 경우)
///   3. 동명 파일 충돌 시: 같은 에이전트 내 파일 우선
///   4. 같은 에이전트 내에도 여러 개면: 가장 최근 updated 파일
///   5. 그래도 해석 불가: broken link로 마킹
fn resolve_wikilink(
    link: &WikiLink,
    registry: &NoteRegistry,
    resolver_context: &ResolverContext,
) -> ResolveResult {
    // 1. UUID 직접 매칭
    if registry.id_to_path.contains_key(&link.target) {
        return ResolveResult::Resolved(link.target.clone());
    }

    // 2. 파일명으로 해석
    let ids = match registry.name_to_ids.get(&link.target) {
        Some(ids) if !ids.is_empty() => ids,
        _ => return ResolveResult::Broken,
    };

    // 2a. 유일한 이름 → 확정
    if ids.len() == 1 {
        return ResolveResult::Resolved(ids[0].clone());
    }

    // 3. 동명 파일 충돌: 같은 에이전트 우선
    let same_agent: Vec<_> = ids.iter()
        .filter(|id| registry.get_agent(id) == Some(&resolver_context.current_agent))
        .collect();
    if same_agent.len() == 1 {
        return ResolveResult::Resolved(same_agent[0].clone());
    }

    // 4. 같은 에이전트 내에도 여러 개: 가장 최근 updated
    let candidates = if same_agent.is_empty() { ids } else { &same_agent.iter().cloned().cloned().collect() };
    let newest = candidates.iter()
        .max_by_key(|id| registry.get_updated(id));
    match newest {
        Some(id) => ResolveResult::Ambiguous {
            chosen: id.clone(),
            alternatives: candidates.iter().filter(|c| *c != id).cloned().collect(),
        },
        None => ResolveResult::Broken,
    }
}

struct ResolverContext {
    current_agent: String,  // wikilink를 포함한 노트의 소속 에이전트
}

enum ResolveResult {
    Resolved(String),                                    // 확정 UUID
    Ambiguous { chosen: String, alternatives: Vec<String> }, // 최선 추측 + 대안 목록
    Broken,                                              // 해석 불가
}
```

---

## 5. 프론트엔드 구현

### 5.1 MemoryAdapter — 기존 코드 호환 레이어

기존 `memoryStore.ts`, `conversationStore.ts`, `chatFlowStore.ts`가 모두 현재 메모리 인터페이스에 의존하므로, **MemoryAdapter**를 두어 점진적으로 전환한다.

```typescript
// src/services/memoryAdapter.ts

import type { MemoryNote } from './types';
import type { VaultNoteSummary } from './vaultTypes';

/**
 * vault 노트를 기존 MemoryNote 형태로 변환하는 어댑터.
 * Phase 1-2에서 기존 UI/프롬프트 빌더가 수정 없이 작동하도록 보장한다.
 */
export function vaultNoteToLegacy(note: VaultNoteSummary): MemoryNote {
  return {
    id: note.id,
    agent_id: note.agent,
    title: note.label,
    content: note.bodyPreview,      // 첫 500자
    created_at: note.created,
    updated_at: note.updated,
  };
}

/**
 * 기존 buildMemorySection() 의 정확한 재구현.
 * 기존 계약을 문자 그대로 보존한다:
 *   - 정렬: created_at 내림차순 (최신 우선)
 *   - 예산: MAX_MEMORY_TOKENS = 500 (estimateTokens 기반, 노트 개수 아님)
 *   - 형식: "- title: content" per line
 *   - 래핑: "[MEMORY NOTES]\n" 헤더
 *
 * 현재 구현 참조: src/services/chatHelpers.ts:112-135
 */
export function buildPromptReadySlice(
  notes: VaultNoteSummary[],
): string {
  if (notes.length === 0) return "";

  // 기존과 동일: created_at 내림차순 (최신 우선)
  const sorted = [...notes].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
  );

  const MAX_MEMORY_TOKENS = 500;
  const lines: string[] = [];
  let tokens = estimateTokens("[MEMORY NOTES]\n");

  for (const note of sorted) {
    const line = `- ${note.label}: ${note.bodyPreview}`;
    const lineTokens = estimateTokens(line + "\n");
    if (tokens + lineTokens > MAX_MEMORY_TOKENS) break;
    tokens += lineTokens;
    lines.push(line);
  }

  if (lines.length === 0) return "";
  return `[MEMORY NOTES]\n${lines.join("\n")}`;
}
```

### 5.2 vaultStore

```typescript
// src/stores/vaultStore.ts
interface VaultStore {
  // 상태
  notes: VaultNoteSummary[];
  graph: GraphData | null;
  selectedNote: VaultNote | null;
  searchResults: SearchResult[];
  conflicts: ConflictInfo[];

  // 필터
  activeAgent: string | null;
  activeCategory: NoteType | null;
  activeTags: string[];

  // 액션
  loadNotes: (agentId?: string) => Promise<void>;
  loadGraph: (agentId?: string, depth?: number) => Promise<void>;
  createNote: (params: CreateNoteParams) => Promise<VaultNote>;
  updateNote: (noteId: string, updates: NoteUpdates) => Promise<VaultNote>;
  deleteNote: (noteId: string) => Promise<void>;
  search: (query: string, scope?: 'self' | 'shared' | 'all') => Promise<void>;
  openInObsidian: () => Promise<void>;
  resolveConflict: (conflictId: string, choice: 'local' | 'remote') => Promise<void>;

  // 프롬프트 호환
  getPromptReadyNotes: (agentId: string, tokenBudget?: number) => VaultNoteSummary[];
}
```

### 5.3 그래프 시각화 컴포넌트

```
src/components/memory/
├── MemoryGraphView.tsx      # D3 force-directed 그래프
├── MemoryNoteViewer.tsx     # 노트 상세 보기 (마크다운 렌더링 + backlinks)
├── MemoryNoteEditor.tsx     # 노트 편집기 (wikilink 자동완성)
├── MemoryNoteList.tsx       # 에이전트별 노트 리스트 (기존 MemoryBar 대체)
├── MemorySearchBar.tsx      # 전문 검색
├── MemoryFilterPanel.tsx    # 에이전트/태그/카테고리 필터
├── MemoryConflictDialog.tsx # 충돌 해결 다이얼로그
└── MemoryGraphControls.tsx  # 줌, 필터, 레이아웃 컨트롤
```

### 5.4 내장 뷰 (Obsidian 미설치 시)

Obsidian이 없어도 완전한 경험을 제공해야 한다:

| 기능 | 구현 |
|------|------|
| **노트 목록** | MemoryNoteList — 필터, 정렬, 에이전트별 그룹 |
| **노트 보기** | MemoryNoteViewer — Markdown 렌더링, wikilink 클릭 가능 |
| **노트 편집** | MemoryNoteEditor — textarea + wikilink 자동완성 |
| **검색** | MemorySearchBar — 전문 검색, 결과 하이라이트 |
| **Backlinks** | NoteViewer 하단에 "이 노트를 참조하는 노트들" 섹션 |
| **그래프** | MemoryGraphView — D3 force-directed (Obsidian graph view의 간소화 버전) |
| **태그 필터** | MemoryFilterPanel — 태그 클릭으로 필터링 |

"Obsidian에서 열기" 버튼은 선택적 편의 기능으로만 제공한다.

### 5.5 그래프 뷰 시각적 인코딩

| 속성 | 인코딩 |
|------|--------|
| 에이전트 소속 | 노드 **색상** (에이전트별 고유 색상) |
| 메모리 타입 | 노드 **모양** (knowledge=원, decision=마름모, reflection=별) |
| confidence | 노드 **크기** + **투명도** |
| 링크 수 | 노드 **크기** 보정 |
| shared 영역 | 노드 **테두리 점선** |
| broken link | 간선 **빨간 점선** |

---

## 6. 에이전트 통합

### 6.1 Tool 마이그레이션 전략

현재 에이전트는 단일 `memory_note` tool (action: create/read/update/delete)을 사용한다.
이를 vault 기반으로 전환하되, **이름과 기존 action 시맨틱을 완전히 보존**한다.

**핵심 결정**: Tool 이름 `memory_note`를 **영구적으로 유지**한다 (deprecate 하지 않음).
- 기존 TOOL_CONFIG.json의 `memory_note` 항목 그대로 유효
- 기존 에이전트 persona 파일 (TOOLS.md) 수정 불필요
- action 필드에 새 값을 추가하여 점진적 기능 확장

**모든 Phase에서의 단일 호환 계약:**

```typescript
const memoryNoteTool = {
  name: "memory_note",          // 변경 없음 — 영구 유지
  description: "메모리를 관리합니다.",
  parameters: {
    action: "string",           // 아래 action별 파라미터 참조

    // === 기존 action (Phase 1부터, 기존 시맨틱 보존) ===

    // action: "create" — 새 메모리 저장
    //   title: string (required)
    //   content: string (required)
    //   category: "knowledge" | "conversation" | "decision" | "reflection" (optional, default: "knowledge")
    //   tags: string[] (optional)
    //   related_ids: string[] (optional, 연결할 다른 노트의 UUID)
    //   scope: "agent" | "shared" (optional, default: "agent")
    //   반환: { id, agent_id, title, content, created_at, updated_at }  ← 기존 MemoryNote 형식

    // action: "read" — 에이전트의 메모리 목록 조회
    //   id: string (optional — 있으면 특정 노트, 없으면 전체 목록)
    //   반환: MemoryNote[] 또는 MemoryNote  ← 기존 형식 유지
    //   ※ id 없이 호출 = 기존 "read all" 동작과 동일

    // action: "update" — 기존 메모리 수정
    //   id: string (required)           ← 현재 코드와 동일한 필드명
    //   title: string (optional)
    //   content: string (optional)
    //   tags: string[] (optional, 전체 교체)
    //   confidence: number (optional, 0.0 ~ 1.0)
    //   반환: { id, agent_id, title, content, created_at, updated_at }  ← agent_id 포함

    // action: "delete" — 메모리 삭제
    //   id: string (required)           ← 현재 코드와 동일한 필드명
    //   반환: { success: true }

    // === 새 action (Phase 2부터 추가) ===

    // action: "search" — 메모리 검색
    //   query: string (required)
    //   scope: "self" | "shared" | "all" (optional, default: "self")
    //   tags: string[] (optional)
    //   limit: number (optional, default: 10)
    //   반환: SearchResult[]

    // action: "recall" — 특정 노트 + 연결된 노트 함께 로드
    //   id: string (required)
    //   depth: number (optional, default: 1)
    //   반환: { note: VaultNote, linked: VaultNote[] }
  }
};
```

**내부 라우팅 (모든 Phase에서 동일한 진입점):**

```rust
// src-tauri/src/commands/tool_commands.rs — 기존 memory_note 핸들러 수정

fn tool_memory_note(agent_id: &str, params: &Value) -> Result<Value, ToolError> {
    let action = params["action"].as_str().unwrap_or("read");
    let vault = get_vault_manager();

    match action {
        "create" => {
            let scope = params.get("scope").and_then(|v| v.as_str()).unwrap_or("agent");
            let note = vault.create_note(agent_id, scope, params)?;
            Ok(note.to_legacy_json(agent_id))
            // to_legacy_json(): { id, agent_id, title, content, created_at, updated_at }
            // 현재 MemoryNote 타입(src/services/types.ts:43-50)과 동일한 shape
        }
        "read" => {
            // "id" 필드명 유지 — 현재 코드(tool_commands.rs:392)와 동일
            if let Some(id) = params.get("id").and_then(|v| v.as_str()) {
                let note = vault.read_note(id)?;
                Ok(note.to_legacy_json(agent_id))
            } else {
                // 기존 동작: 해당 에이전트의 모든 노트 목록
                let notes = vault.list_notes(Some(agent_id), None, None)?;
                Ok(notes.iter().map(|n| n.to_legacy_json(agent_id)).collect())
            }
        }
        "update" => {
            // "id" 필드명 유지 — 현재 코드(tool_commands.rs:392)와 동일
            let id = params["id"].as_str().ok_or(ToolError::MissingParam("id"))?;
            let note = vault.update_note_with_caller(id, agent_id, params)?;
            // shared 노트이면 last_edited_by에 agent_id 기록
            Ok(note.to_legacy_json(agent_id))
        }
        "delete" => {
            // "id" 필드명 유지 — 현재 코드(tool_commands.rs:402)와 동일
            let id = params["id"].as_str().ok_or(ToolError::MissingParam("id"))?;
            // shared 노트는 에이전트가 삭제 불가 — caller="agent" 전달
            vault.delete_note_with_caller(id, "agent")?;
            Ok(json!({ "success": true }))
        }
        // Phase 2+ 에서 추가
        "search" => {
            let query = params["query"].as_str().ok_or(ToolError::MissingParam("query"))?;
            let scope = params.get("scope").and_then(|v| v.as_str()).unwrap_or("self");
            let results = vault.search(query, Some(agent_id), Some(scope), None)?;
            Ok(serde_json::to_value(results)?)
        }
        "recall" => {
            let id = params["id"].as_str().ok_or(ToolError::MissingParam("id"))?;
            let depth = params.get("depth").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
            let result = vault.recall(id, depth)?;
            Ok(serde_json::to_value(result)?)
        }
        unknown => Err(ToolError::UnknownAction(unknown.to_string())),
    }
}
```

**`to_legacy_json()` 구현 — 현재 MemoryNote 형식 완전 보존:**

```rust
impl VaultNote {
    /// 현재 MemoryNote 타입(src/services/types.ts:43-50)과 동일한 JSON shape 반환.
    /// 필드: id, agent_id, title, content, created_at, updated_at
    fn to_legacy_json(&self, agent_id: &str) -> Value {
        json!({
            "id": self.id,
            "agent_id": agent_id,
            "title": self.title,
            "content": self.body,
            "created_at": self.created,
            "updated_at": self.updated,
        })
    }
}
```

**TOOL_CONFIG.json 마이그레이션**: 불필요. `memory_note` 이름이 동일하므로 기존 설정이 그대로 작동한다.

### 6.2 프롬프트 호환 레이어

`chatHelpers.ts:buildMemorySection()`의 기존 동작을 보존하면서 vault 데이터를 사용한다:

```
chatFlowStore에서 프롬프트 조립
    ↓
vaultStore.getPromptReadyNotes(agentId, 500)
    ↓
MemoryAdapter.buildPromptReadySlice()
    ↓
기존과 동일한 [MEMORY NOTES] 블록 생성
    ↓
시스템 프롬프트에 주입 (기존 위치, 기존 형식)
```

**변경 없는 것**: 정렬 기준 (created_at 내림차순), 토큰 예산 (MAX_MEMORY_TOKENS=500, estimateTokens 기반), 블록 형식 (`- title: content`), 헤더 (`[MEMORY NOTES]\n`), 프롬프트 내 위치 (skills 뒤, summary 앞)
**변경되는 것**: 데이터 소스 (SQLite → vault 파일). 동작과 형식은 동일.

### 6.3 자동 메모리 추출 (opt-in per agent)

에이전트별로 `_index.md`에 설정:

```yaml
# agents/manager/_index.md frontmatter
auto_extract: true           # false면 수동만
extract_on: "conversation_end"  # "conversation_end" | "message_count:20"
```

추출 프로세스:
1. 대화 종료 시 LLM에 대화 요약 + 메모리 후보 추출 요청
2. **후보를 사용자에게 표시** (자동 저장 아님)
3. 사용자 승인 후 vault에 저장
4. 기존 노트와 자동 링크 연결

---

## 7. Export/Import (Phase 1부터 포함)

기존 export/import가 `memory_notes.json`을 포함하므로, vault 전환 시 이 경로도 함께 업데이트해야 한다.

### 7.1 Export 형식 변경

```
기존: agent_export.zip
├── agent.json
├── persona/
│   ├── IDENTITY.md
│   └── ...
├── memory_notes.json        ← SQLite에서 추출한 flat JSON
└── conversations/

신규: agent_export.zip
├── agent.json
├── persona/
│   ├── IDENTITY.md
│   └── ...
├── memory/                  ← 에이전트 전용 vault 폴더 구조
│   ├── knowledge/
│   ├── conversations/
│   ├── decisions/
│   └── reflections/
├── shared_refs/             ← 에이전트가 참조하는 shared 노트만 포함
│   ├── project/
│   └── ...
├── memory_notes.json        ← 하위 호환용 (vault에서 flat JSON 생성)
└── conversations/
```

### 7.2 Import 전략

```rust
fn import_agent_memory(archive: &ZipArchive, agent_id: &str) -> Result<(), ImportError> {
    // 1. memory/ 디렉토리가 있으면: vault 형식으로 직접 복원
    if archive.has_dir("memory/") {
        self.restore_vault_files(archive, agent_id)?;
    }
    // 2. memory_notes.json만 있으면: legacy 형식 → vault로 변환
    else if archive.has_file("memory_notes.json") {
        let legacy_notes = parse_legacy_json(archive)?;
        self.migrate_legacy_notes(legacy_notes, agent_id)?;
    }
    // 3. 둘 다 없으면: 메모리 없이 import

    // 4. shared_refs/ 가 있으면: shared 노트 dedup import
    if archive.has_dir("shared_refs/") {
        self.import_shared_refs(archive)?;
        // id 기준 dedup: 이미 존재하는 shared 노트는 skip
        // 없으면 shared/ 에 생성
    }

    Ok(())
}
```

---

## 8. 마이그레이션 계획 (재구성)

### Phase 1: 기반 구축 + 안전망 (Vault 엔진 + In-place 전환)

**목표**: vault를 single source of truth로 전환하되, 기존 기능이 모두 정상 작동

**전환 전략**: LegacyBridge 같은 별도 호환 레이어를 두지 않는다. 대신 기존 핸들러(`tool_commands.rs`의 `tool_memory_note`)를 **in-place로 수정**하여 백엔드만 SQLite → VaultManager로 교체한다. 반환 형식(`to_legacy_json()`)과 파라미터 이름(`id`)은 기존과 동일하게 유지.

1. **VaultManager 구현**
   - 노트 CRUD (파일 시스템 I/O)
   - Frontmatter 파서 (serde_yaml)
   - NoteRegistry (id↔path 맵)
   - Wikilink 파서 + LinkIndex
   - VaultSecurity (vault 전용 경로 보안, 새 파일 경로 포함)
   - VaultWatcher (notify crate — Phase 1부터)

2. **기존 핸들러 In-place 수정**
   - `tool_commands.rs`의 `tool_memory_note`: DB 호출을 `vault.*` 호출로 교체
   - `to_legacy_json(agent_id)` 로 기존 `MemoryNote` shape 유지: `{ id, agent_id, title, content, created_at, updated_at }`
   - 기존 Tauri 커맨드(`create_memory_note` 등)도 내부에서 vault로 위임
   - 파라미터 이름 보존: update/delete는 `id` 필드 사용 (현재 코드와 동일)

3. **SQLite → Vault 마이그레이션**
   - `vault_migrate_preview`: 변환 미리보기 (노트 수, 예상 구조)
   - `vault_migrate_execute`: 자동 변환 (legacy_id 보존, frontmatter 생성)
   - SQLite memory_notes 테이블은 read-only로 유지 (롤백 안전망)

4. **Export/Import 호환**
   - 새 export에 `memory/` 폴더 + `shared_refs/` + `memory_notes.json` 동시 포함
   - Import 시 양쪽 형식 모두 지원 + shared dedup

5. **프롬프트 호환**
   - MemoryAdapter 구현 — vault 노트를 기존 프롬프트 형식으로 변환
   - `buildMemorySection()` 수정: 데이터 소스만 vault로 변경, 정렬/토큰/형식 그대로

**완료 기준**: 기존 기능 100% 동작 + vault 파일이 실제로 생성됨 + 기존 Tool 호출이 동일한 결과 반환

### Phase 2: 프론트엔드 전환

**목표**: 기존 MemoryBar를 vault 기반 UI로 교체

1. `vaultStore.ts` 구현
2. MemoryNoteList (기존 MemoryBar 교체) — 카테고리/태그 필터
3. MemoryNoteViewer — Markdown 렌더링 + backlinks
4. MemoryNoteEditor — 생성/편집 + wikilink 자동완성
5. MemorySearchBar — 전문 검색
6. MemoryConflictDialog — 충돌 해결 UI
7. Tool 확장: `memory_note` tool에 `search`와 `recall` action 추가

**완료 기준**: MemoryBar 완전 교체 + 검색/backlink 작동

### Phase 3: 그래프 시각화 + Obsidian 연동

**목표**: 지식 그래프 시각화 + Obsidian에서 열기

1. D3 force-directed MemoryGraphView 컴포넌트
2. 에이전트별 필터링 + 색상 구분
3. 노드 인터랙션 (클릭→상세, 호버→강조, 줌, 드래그)
4. `.obsidian/` 설정 생성 + "Obsidian에서 열기" 버튼
5. 그래프 뷰 컨트롤 (레이아웃, 필터, 줌)

**완료 기준**: 그래프 뷰 동작 + Obsidian 열기 가능

### Phase 4: 고급 기능 + Legacy 정리

**목표**: 고급 메모리 기능 추가 + legacy 코드 제거

1. Confidence decay (타입별 차등 감쇠, 섹션 9 참조)
2. 에이전트 간 메모리 충돌 감지
3. 자동 메모리 추출 (opt-in per agent)
4. **Legacy 정리**: SQLite memory_notes 테이블 drop
5. 기존 memoryStore.ts, memoryCommands.ts 제거 (vaultStore로 완전 대체)
6. 기존 Tauri CRUD 커맨드(`create_memory_note` 등) 제거 — vault 커맨드만 유지

**완료 기준**: legacy 코드 제거 완료 + 모든 테스트 통과

---

## 9. Confidence Decay 설계 (미해결 질문 해결)

타입별 차등 감쇠를 적용한다. 글로벌 단일 곡선이 아닌, 메모리 종류에 따라 감쇠율을 다르게 설정한다.

| 타입 | stale_after | 감쇠 곡선 | 이유 |
|------|-------------|-----------|------|
| `knowledge` | 90일 | 느린 선형 | 학습한 지식은 오래 유효 |
| `conversation` | 14일 | 빠른 지수 | 대화 맥락은 빠르게 희미해짐 |
| `decision` | 180일 | 매우 느린 선형 | 의사결정은 장기간 유효 |
| `reflection` | 365일 | 거의 감쇠 없음 | 피드백/교훈은 반영구적 |

```rust
fn decay_confidence(note: &VaultNote) -> f64 {
    let days_since_update = (now() - note.updated).num_days() as f64;
    let (stale_after, curve) = match note.note_type {
        NoteType::Knowledge    => (90.0,  DecayCurve::Linear),
        NoteType::Conversation => (14.0,  DecayCurve::Exponential),
        NoteType::Decision     => (180.0, DecayCurve::Linear),
        NoteType::Reflection   => (365.0, DecayCurve::Linear),
    };

    let decay_factor = match curve {
        DecayCurve::Linear => (1.0 - days_since_update / stale_after).max(0.1),
        DecayCurve::Exponential => (-(days_since_update / stale_after) * 2.0).exp().max(0.1),
    };

    note.confidence * decay_factor
}
```

**`last_validated_at` 필드**: 노트가 재확인되면 (에이전트가 recall 후 update하거나, 사용자가 편집하면) `updated`를 갱신하여 감쇠를 리셋한다.

---

## 10. 기술 선택

| 영역 | 선택 | 대안 | 이유 |
|------|------|------|------|
| Frontmatter YAML | `serde_yaml` | 수동 파서 | serde 생태계 통합, 타입 안전 |
| Wikilink 파싱 | `regex` | pulldown-cmark | wikilink는 비표준 — 정규식이 적합 |
| 검색 (Phase 1-2) | 단순 텍스트 매칭 (walkdir + 문자열 검색) | — | 초기 파일 수 적음 |
| 검색 (Phase 3+) | `tantivy` | — | 그래프 뷰 + recall 기능에 인덱싱 필요 |
| 그래프 시각화 | D3.js force-directed | cytoscape.js, sigma.js | React 통합 용이, 커스터마이징 |
| 파일 감시 | `notify` crate v7 | polling | 실시간, 크로스 플랫폼 |
| 동시성 | optimistic concurrency (revision hash) | file locking | Obsidian과 호환 (lock 미지원) |
| 디렉토리 탐색 | `walkdir` | `std::fs::read_dir` 재귀 | 성능, 에러 처리 |

---

## 11. 의존성 추가

### Rust (Cargo.toml)

```toml
[dependencies]
regex = "1"           # wikilink 파싱
serde_yaml = "0.9"    # frontmatter 파싱
notify = "7"          # 파일 변경 감지
walkdir = "2"         # 디렉토리 트리 탐색
sha2 = "0.10"         # revision hash
```

### Frontend (package.json)

```json
{
  "dependencies": {
    "d3": "^7",
    "d3-force": "^3",
    "@types/d3": "^7"
  }
}
```

---

## 12. 보안 고려사항

1. **Vault 전용 경로 보안**: `VaultSecurity` 모듈로 vault 외부 접근 차단 (symlink traversal 방지, canonicalize 사용)
2. **에이전트 격리**: 에이전트는 자신의 폴더 + `shared/`만 접근 가능 — cross-agent 접근 차단
3. **파일명 새니타이징**: 특수 문자, 경로 구분자, `.` 접두사, null byte 필터링, 200자 제한
4. **Frontmatter 인젝션 방지**: serde_yaml 타입 안전 파싱 (허용된 필드만 역직렬화)
5. **크기 제한**: 단일 노트 최대 100KB, vault당 최대 10,000개 노트
6. **`.obsidian/` 보호**: 에이전트/Tool은 `.obsidian/` 디렉토리에 쓰기 불가
7. **Import 경로 검증**: ZIP 엔트리의 path traversal 방지 (기존 export_commands.rs 패턴 활용)

---

## 13. 테스트 전략

### 13.1 단위 테스트 (Rust)

| 영역 | 테스트 항목 |
|------|-------------|
| `note.rs` | frontmatter 파싱/직렬화, 잘못된 YAML 처리, 필수 필드 누락 |
| `links.rs` | wikilink 파싱, ID/이름 기반 해석, broken link 감지 |
| `security.rs` | path escape 차단, cross-agent 접근 차단, 파일명 새니타이징 |
| `migration.rs` | SQLite→vault 변환, legacy_id 보존, 빈 테이블 처리 |
| `watcher.rs` | create/modify/rename/delete 이벤트 처리, debouncing |

### 13.2 통합 테스트

| 시나리오 | 검증 내용 |
|----------|-----------|
| **Legacy tool 호환** | 기존 `memory_note` tool의 create/read/update/delete가 vault에 정상 저장 |
| **프롬프트 회귀** | vault 전환 후 `[MEMORY NOTES]` 블록이 기존과 동일한 형식/위치/토큰 예산 유지 |
| **Export/Import 왕복** | vault export → 다른 에이전트에 import → 메모리 + wikilink 복원 |
| **Obsidian 편집 동기화** | 외부에서 파일 수정 → watcher가 감지 → UI에 반영 |
| **충돌 처리** | Window Agent와 외부 편집 동시 발생 → conflict copy 생성 → UI 알림 |
| **SQLite 마이그레이션** | 기존 노트 N개 → vault 파일 N개 + 정확한 frontmatter |

### 13.3 프론트엔드 테스트 (Vitest)

| 영역 | 테스트 항목 |
|------|-------------|
| `memoryAdapter` | vaultNoteToLegacy 변환, buildPromptReadySlice 토큰 예산 준수 |
| `vaultStore` | CRUD 동작, 필터링, 검색 결과 정합성 |
| `MemoryGraphView` | 그래프 렌더링, 노드 클릭 이벤트, 에이전트 필터 |

---

## 14. 결정 사항 (미해결 질문 해결)

| 질문 | 결정 | 근거 |
|------|------|------|
| 검색 엔진 전략 | Phase 1-2: walkdir + 텍스트 매칭, Phase 3+: tantivy | 그래프 뷰와 recall에 인덱싱 필요 — Phase 3 전에 도입 |
| 자동 메모리 추출 | **opt-in per agent**, 후보를 사용자에게 표시 후 승인 | 투명성 + 노이즈 방지 |
| Confidence decay | **타입별 차등 감쇠** (섹션 9) | decision/reflection은 장기 유효, conversation은 빠른 감쇠 |
| 기존 데이터 마이그레이션 | **자동 변환 + 미리보기**, legacy_id 보존, SQLite read-only 유지 | 안전한 롤백 보장 |
| Obsidian 미설치 시 | **내장 UI로 완전한 경험 제공** (목록, 뷰어, 편집, 검색, backlinks, 그래프) | Obsidian은 선택적 보너스 |
| 동시 접근 충돌 | **Optimistic concurrency** (revision hash) + conflict copy | file locking은 Obsidian과 호환 불가 |

---

## 부록 A: 메모리 노트 템플릿

### knowledge.md
```markdown
---
id: ""
agent: ""
type: "knowledge"
tags: []
confidence: 0.8
created: ""
updated: ""
revision: ""
source: ""
aliases: []
---

# {{제목}}

{{내용}}

## 관련 정보
-
```

### decision.md
```markdown
---
id: ""
agent: ""
type: "decision"
tags: []
confidence: 0.9
created: ""
updated: ""
revision: ""
source: ""
aliases: []
---

# {{결정 사항}}

## 맥락
{{왜 이 결정이 필요했는가}}

## 선택지
1. {{옵션 A}} — {{장단점}}
2. {{옵션 B}} — {{장단점}}

## 결정
{{선택한 옵션과 이유}}

## 관련 정보
-
```

### reflection.md
```markdown
---
id: ""
agent: ""
type: "reflection"
tags: []
confidence: 0.85
created: ""
updated: ""
revision: ""
source: ""
aliases: []
---

# {{피드백/성찰 제목}}

## 무엇을 배웠는가
{{핵심 교훈}}

## 왜 중요한가
{{이유}}

## 적용 방법
{{구체적인 행동 변화}}

## 관련 정보
-
```

## 부록 B: 마이그레이션 시 데이터 변환 예시

### SQLite → Vault

```
SQLite row:
  id: "abc123"
  agent_id: "manager-uuid"
  title: "사용자는 한국어 선호"
  content: "모든 응답을 한국어로..."
  created_at: "2026-03-10T09:00:00"
  updated_at: "2026-03-15T14:00:00"

→ vault/agents/manager/knowledge/사용자는-한국어-선호.md:
  ---
  id: "new-uuid-v4"
  agent: "manager"
  type: "knowledge"
  tags: ["user-preference", "language"]
  confidence: 0.8
  created: "2026-03-10T09:00:00+09:00"
  updated: "2026-03-15T14:00:00+09:00"
  revision: "a1b2c3d4"
  source: "migration:sqlite"
  aliases: []
  legacy_id: "abc123"
  ---

  # 사용자는 한국어 선호

  모든 응답을 한국어로...
```
