# Memory & Vault System

> 에이전트의 장기 기억을 관리하는 두 계층: 파일 기반 Consolidated Memory와 Markdown Knowledge Graph (Vault).

---

## 1. Consolidated Memory (파일 기반)

### 1.1 디렉토리 구조

```
{app_data_dir}/memory/{agent_id}/
  consolidated.md                    -- 현재 누적 메모리
  snapshots/v{N}_{timestamp}.md      -- 버전 스냅샷
  digests/{conversation_id}.md       -- 대화별 요약
```

에이전트별로 완전히 격리된 디렉토리 구조를 가진다.

### 1.2 SystemMemoryManager

`app.manage()`로 등록되는 Managed State.

```rust
pub struct SystemMemoryManager {
    base_path: PathBuf,    // {app_data_dir}/memory
}
```

### 1.3 API

| 메서드 | 설명 |
|--------|------|
| `read_consolidated(agent_id)` | 현재 consolidated.md 읽기. 없으면 `None` |
| `write_consolidated(agent_id, content, version)` | 기존 파일을 `snapshots/v{version}_{timestamp}.md`로 아카이브 후 새 내용 저장 |
| `write_digest(agent_id, conversation_id, content)` | 대화 요약을 `digests/{conversation_id}.md`로 저장 (덮어쓰기) |
| `read_digest(agent_id, conversation_id)` | 특정 대화 요약 읽기. 없으면 `None` |
| `list_digests(agent_id)` | 모든 digest의 `(conversation_id, created_at)` 메타데이터 목록 반환 (수정 시각 순) |
| `get_memory_path(agent_id)` | 에이전트별 메모리 디렉토리 경로 반환 |

### 1.4 LLM 연동

`actor_context::resolve()`에서 `SystemMemoryManager.read_consolidated(agent_id)`를 호출하여 `ResolvedContext.consolidated_memory`에 저장한다. 이 값은 시스템 프롬프트에 `[CONSOLIDATED MEMORY]` 섹션으로 주입된다.

```
시스템 프롬프트 구성:
  persona (IDENTITY + SOUL + USER + AGENTS)
  + registered_agents_section (팀 모드)
  + learning_mode_prompt (학습 모드)
  + tools_section
  + credentials_section
  + [CONSOLIDATED MEMORY] ← consolidated.md 내용
  + role_instruction
```

### 1.5 Digest 시스템

대화 종료 시 LLM이 `consolidate_memory` 도구를 호출하면:
1. `write_digest(agent_id, conversation_id, digest_content)` -- 대화 요약 저장
2. `write_consolidated(agent_id, merged_content, new_version)` -- 기존 메모리 + 새 digest 병합
3. conversation 테이블에 `digest_id`, `consolidated_at` 기록

---

## 2. Memory Notes (DB)

에이전트별 간단한 텍스트 노트를 DB에 저장하는 보조 시스템.

### 2.1 Tauri 커맨드

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `create_memory_note` | `agent_id, title, content` | `MemoryNote` |
| `list_memory_notes` | `agent_id` | `Vec<MemoryNote>` |
| `update_memory_note` | `id, title?, content?` | `MemoryNote` |
| `delete_memory_note` | `id` | `()` |

### 2.2 프론트엔드: memoryStore

```typescript
interface MemoryState {
  notes: MemoryNote[];
  currentAgentId: string | null;
  loadNotes(agentId: string): Promise<void>;
  addNote(agentId: string, title: string, content: string): Promise<void>;
  editNote(id: string, title?: string, content?: string): Promise<void>;
  removeNote(id: string): Promise<void>;
  clear(): void;
}
```

---

## 3. Vault System (Knowledge Graph)

파일 기반 Markdown 노트 시스템. Obsidian 호환 형식으로 노트를 저장하며, 태그/링크 기반 그래프를 제공한다.

### 3.1 디렉토리 구조

```
{app_data_dir}/vault/
  agents/{agent_id}/              -- 에이전트별 노트
    notes/{note_id}.md
    workspace/                    -- 에이전트 작업 공간 (인덱스에서 제외)
  shared/                         -- 공유 노트
    project/
    people/
    incidents/
    glossary/
  templates/                      -- 템플릿 파일
```

### 3.2 VaultManager

`Mutex<VaultManager>`로 `VaultState` 타입으로 Tauri에 등록.

```rust
pub struct VaultManager {
    vault_path: PathBuf,
    registry: NoteRegistry,       // ID → 메타데이터 인메모리 인덱스
    link_index: LinkIndex,        // 노트 간 링크 인덱스
    security: VaultSecurity,      // 경로 트래버설 방지
}
```

초기화 시 `rebuild_index()`로 전체 .md 파일을 스캔하여 인메모리 인덱스를 구축한다. `.obsidian` 디렉토리와 `_index.md` 파일, `agents/*/workspace/**` 경로는 스캔에서 제외된다.

### 3.3 VaultNote YAML Frontmatter

각 노트는 YAML frontmatter + Markdown body로 구성된다:

```yaml
---
id: "uuid"
agent: "agent-id"
type: "concept"              # concept | reference | user-feedback | ...
tags:
  - tag1
  - tag2
confidence: 0.8              # 0.0 ~ 1.0 (기본값: 0.5)
created: "2026-03-29T..."
updated: "2026-03-29T..."
revision: "a1b2c3d4"         # SHA-256 첫 8자 (content hash)
source: "conversation"       # optional
aliases:                     # optional, 빈 배열이면 생략
  - "alias1"
scope: "self"                # optional: "self" | "shared"
last_edited_by: "agent-id"  # optional
source_conversation: "conv-id"  # optional
legacy_id: "old-id"         # optional (마이그레이션용)
---
# Note Title

Markdown body content here...
```

**Frontmatter 파싱:**
- `parse_frontmatter(content)` → `(Frontmatter, body_string)`
- `serialize_note(frontmatter, body)` → 전체 Markdown 문자열

**Revision 계산:**
- `compute_revision(content)` = `hex(SHA-256(content)[0..4])` → 8자 hex

**파일명:**
- `sanitize_title_to_filename(title)` → 특수문자(`/\:*?"<>|`)를 `-`로 변환, 연속 `-` 축소

### 3.4 CRUD

| 기능 | VaultManager 메서드 | 설명 |
|------|---------------------|------|
| Create | `create_note(agent_id, scope?, category, title, content, tags, related_ids)` | frontmatter 생성, 파일 저장, 인덱스 갱신, related_ids로 링크 추가 |
| Read | `read_note(note_id)` | frontmatter 파싱 + body 반환 |
| Update | `update_note(note_id, caller_agent_id, title?, content?, tags?, confidence?, add_links?)` | 변경사항 적용, revision 재계산, last_edited_by 갱신 |
| Delete | `delete_note(note_id, caller)` | 파일 삭제, 인덱스에서 제거, 역링크 정리 |
| List | `list_notes(agent_id?, category?, tags?)` | 필터 조건에 맞는 `VaultNoteSummary[]` 반환 |
| Archive | `archive_note(note_id, agent_id)` | 노트를 `_archived/` 하위로 이동 |

### 3.5 Search

```rust
vault.search(query, agent_id?, scope?) -> Vec<SearchResult>
```

인메모리 `NoteRegistry`에서 title, tags, body를 대상으로 텍스트 검색. `SearchResult`에는 매칭 스코어가 포함된다.

### 3.6 Graph

```rust
vault.get_graph(agent_id?, depth?, include_shared) -> GraphData
```

- `GraphData`에는 `nodes[]`와 `edges[]` (링크 관계)가 포함
- `depth`로 탐색 깊이 제한 가능
- `include_shared`로 공유 노트 포함 여부 결정

### 3.7 Backlinks

```rust
vault.get_backlinks(note_id) -> Vec<LinkRef>
```

특정 노트를 참조하는 다른 노트 목록 반환. `LinkRef`에는 source_id와 link_type이 포함.

### 3.8 Decay (시간 감쇠)

Vault 노트의 신뢰도를 시간 경과에 따라 감쇠시키는 **compute-on-read** 방식:

```
effective_confidence = confidence * exp(-lambda * age_days)
```

- `lambda`: 감쇠율 (높을수록 빠르게 감쇠)
- `age_days`: updated 시각으로부터 경과 일수
- `min_confidence`: 하한값 (감쇠 후에도 이 값 이하로 내려가지 않음)
- `is_stale`: `age_days > stale_days`이면 true

**DB나 파일을 수정하지 않는** 순수 읽기 연산이다. `vault_list_notes_with_decay` 커맨드로 프론트엔드에서 호출.

### 3.9 Obsidian 연동

```rust
vault_open_in_obsidian(app)
```

`obsidian://open?vault={vault_name}` URI scheme을 통해 Obsidian에서 볼트를 연다. `tauri-plugin-opener`를 사용.

---

## 4. VaultWatcher (외부 편집 동기화)

### 4.1 구조

```rust
pub struct VaultWatcher {
    vault_path: PathBuf,
    debounce_ms: u64,        // 기본값: 300ms
}
```

`notify` crate의 `RecommendedWatcher`를 사용하여 볼트 디렉토리를 재귀적으로 감시한다.

### 4.2 동작

1. 파일 변경 이벤트 수신 (Create, Modify, Remove)
2. `.md` 파일만 필터링
3. debounce (300ms) — 짧은 시간 내 여러 이벤트를 하나로 병합
4. 변경된 파일의 note_id 추출 (frontmatter 파싱)
5. Tauri 이벤트 emit:

| 이벤트명 | 설명 |
|----------|------|
| `vault:note-changed` | 파일 생성 또는 수정 |
| `vault:note-moved` | 파일 이동 |
| `vault:note-removed` | 파일 삭제 |

페이로드: `{ path: String, note_id: Option<String> }`

프론트엔드는 이 이벤트를 받아 노트 목록과 인덱스를 갱신한다.

---

## 5. Tauri 커맨드 목록

### Note CRUD

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `vault_create_note` | `agent_id, scope?, category, title, content, tags[], related_ids[]` | `VaultNote` |
| `vault_read_note` | `note_id` | `VaultNote` |
| `vault_update_note` | `note_id, caller_agent_id, title?, content?, tags?, confidence?, add_links?` | `VaultNote` |
| `vault_delete_note` | `note_id, caller` | `()` |
| `vault_list_notes` | `agent_id?, category?, tags?` | `Vec<VaultNoteSummary>` |

### Search & Graph

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `vault_search` | `query, agent_id?, scope?, limit?` | `Vec<SearchResult>` |
| `vault_get_graph` | `agent_id?, depth?, include_shared` | `GraphData` |
| `vault_get_backlinks` | `note_id` | `Vec<LinkRef>` |

### Management

| 커맨드 | 파라미터 | 반환 |
|--------|---------|------|
| `vault_get_path` | (없음) | `String` (볼트 경로) |
| `vault_open_in_obsidian` | (없음) | `()` |
| `vault_rebuild_index` | (없음) | `IndexStats` |
| `vault_archive_note` | `note_id, agent_id` | `()` |
| `vault_list_notes_with_decay` | `agent_id?, category?, lambda, min_confidence, stale_days` | `Vec<VaultNoteSummaryWithDecay>` |

---

## 6. 프론트엔드

### 6.1 Stores

| Store | 파일 | 역할 |
|-------|------|------|
| `useMemoryStore` | `src/stores/memoryStore.ts` | Memory Notes CRUD |
| `useVaultStore` | `src/stores/vaultStore.ts` | Vault 전체 상태 관리 |

**memoryStore 주요 상태:**
- `notes[]`, `currentAgentId`
- 액션: `loadNotes`, `addNote`, `editNote`, `removeNote`, `clear`

**vaultStore 주요 상태:**
- `notes: VaultNoteSummary[]`, `notesStatus`, `graph: GraphData | null`
- `selectedNote: VaultNote | null`, `searchResults[]`, `conflicts[]`
- 필터: `activeAgent`, `activeCategory`, `activeTags`
- 액션: `loadNotes`, `loadGraph`, `createNote`, `updateNote`, `deleteNote`
- `search(query, scope?)`, `selectNote(noteId)`, `openInObsidian()`
- `resolveConflict(noteId, choice)` -- 외부 편집 충돌 해결
- `setActiveAgent`, `setActiveCategory`, `setActiveTags` -- 필터
- `getPromptReadyNotes(agentId)` -- LLM 프롬프트용 노트 목록

### 6.2 Components

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| `VaultPanel` | `src/components/vault/VaultPanel.tsx` | 볼트 메인 레이아웃 |
| `VaultHeader` | `src/components/vault/VaultHeader.tsx` | 헤더 (Obsidian 열기 등) |
| `VaultEmptyState` | `src/components/vault/VaultEmptyState.tsx` | 노트 없을 때 안내 |
| `NoteListPane` | `src/components/vault/NoteListPane.tsx` | 노트 목록 패널 |
| `NoteListItem` | `src/components/vault/NoteListItem.tsx` | 개별 노트 목록 아이템 |
| `NoteFilterBar` | `src/components/vault/NoteFilterBar.tsx` | 카테고리/태그 필터 |
| `NoteSearchBar` | `src/components/vault/NoteSearchBar.tsx` | 검색바 |
| `NoteDetailPane` | `src/components/vault/NoteDetailPane.tsx` | 노트 상세 보기 |
| `NoteContent` | `src/components/vault/NoteContent.tsx` | Markdown 렌더링 |
| `NoteMetadataBar` | `src/components/vault/NoteMetadataBar.tsx` | 메타데이터 표시 (tags, confidence 등) |
| `NoteEditor` | `src/components/vault/NoteEditor.tsx` | 노트 편집 |
| `NoteEditorToolbar` | `src/components/vault/NoteEditorToolbar.tsx` | 편집 도구 모음 |
| `CreateNoteDialog` | `src/components/vault/CreateNoteDialog.tsx` | 새 노트 생성 다이얼로그 |
| `BacklinksSection` | `src/components/vault/BacklinksSection.tsx` | 역링크 목록 |
| `GraphCanvas` | `src/components/vault/GraphCanvas.tsx` | 노트 관계 그래프 시각화 (Canvas) |
| `GraphPane` | `src/components/vault/GraphPane.tsx` | 그래프 패널 래퍼 |
