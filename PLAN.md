# Window Agent Structural Improvement Plan

## Overview

Window Agent is a full-stack Tauri desktop application (Rust backend + React/TypeScript frontend) with features including agent management, chat, browser automation, P2P relay networking, vault/knowledge base, team orchestration, and cron scheduling.

This plan addresses structural improvements identified through comprehensive codebase analysis. The goal is to reduce code duplication, improve separation of concerns, and make the codebase more maintainable without changing external behavior.

## Current State

- **Rust backend:** ~27,050 lines across 70 files; 18 files exceed 600 LOC
- **Frontend:** ~25,600 lines across 70+ components; 15 components exceed 200 LOC
- **Tests:** 535 Rust tests, 46 frontend test files
- **Key pain points:** Large monolithic files, duplicated patterns, mixed responsibilities

---

## Phase 1: Frontend — Extract Targeted Utility Hooks (Priority: High)

### 1A. Create `useLoadOnOpen()` hook

**Problem:** Several components repeat an async load-with-loading/error-state pattern, but each is triggered differently:
- `CredentialManager.tsx` (lines 45-60): loads on mount (`useEffect(() => refresh(), [])`)
- `NetworkSettingsPanel.tsx` (lines 81-92): loads when `isOpen` changes (`useEffect(() => { if (isOpen) fetchModels() }, [isOpen])`)
- `CronEditor.tsx` (line 42-44): loads when `editingJobId` changes (`useEffect(() => { if (editingJobId) getCronJob(...) }, [editingJobId])`)

**Plan:**
- Create `/src/hooks/useLoadOnOpen.ts` with an `enabled` trigger:
  ```typescript
  function useLoadOnOpen<T>(loader: () => Promise<T>, enabled?: boolean): {
    data: T | null; loading: boolean; error: string; reload: () => Promise<void>;
  }
  ```
  - `enabled` defaults to `true` (mount-triggered)
  - When `enabled` is passed (e.g., `isOpen`, `!!editingJobId`), load fires on transition to `true`
- Apply only to **automatic load** instances above
- **Exclude** user-triggered actions like health check (`NetworkSettingsPanel.tsx:136`) — these remain as inline handlers
- Add unit tests in `/src/hooks/__tests__/useLoadOnOpen.test.ts`

**Affected files:** 3 component files
**Risk:** Low — pure extraction, no behavior change

### 1B. Create `useClipboardFeedback()` hook

**Problem:** Copy-to-clipboard with temporary "Copied" feedback repeated in:
- `ChatMessage.tsx` (line 33): `setTimeout(() => setCopied(false), 1500)`
- `NetworkSettingsPanel.tsx` (line 575): `setTimeout(() => setPeerIdCopied(false), 2000)`
- `InviteDialog.tsx` (line 84): `setTimeout(() => setCopied(false), 2000)`

**Plan:**
- Create `/src/hooks/useClipboardFeedback.ts`
- Consolidate the 3 instances above

**Affected files:** 3 component files
**Risk:** Low

**Note:** Phase 1 intentionally omits a generic `useFormState()` hook — `CredentialManager` already uses a well-structured `FormState` interface (lines 21-41), and `CronEditor`/`AgentEditor` have domain-specific form logic that doesn't benefit from generalization.

---

## Phase 2: Frontend — Break Up Large Components (Priority: High)

### 2A. Split `NetworkSettingsPanel.tsx` (592 lines, 26 useState)

**Problem:** Single component manages 5 unrelated concerns with two different persistence models:
- **Footer-saved (staged):** API key, base URL, model name — harvested via `getValues()` by `SettingsModal` on save
- **Immediately persisted:** Proxy, relay URL, relay tools, network toggle — each action saves directly to backend

**Plan:**
- Extract into sub-components with explicit persistence contracts:
  - `ApiServerSection.tsx` — **footer-saved**: exposes `getValues()` via forwardRef, no direct persistence (~120 lines)
  - `ProxySection.tsx` — **immediately persisted**: manages own save/detect lifecycle (~80 lines)
  - `NetworkToggleSection.tsx` — **immediately persisted**: toggle + consent modal (~80 lines)
  - `RelayConfigSection.tsx` — **immediately persisted**: relay URL save (~60 lines)
  - `RelayToolsSection.tsx` — **immediately persisted**: tool allowlist save (~80 lines)
- `NetworkSettingsPanel.tsx` orchestrates only the footer-saved section's ref and passes `isOpen` to children (~100 lines)
- Apply `useLoadOnOpen` from Phase 1A where applicable (model list loading, health check)

**Affected files:** 1 file → 6 files
**Risk:** Medium — UI regression possible; requires visual verification
**Rollback:** Git revert of the single commit

### 2B. Finish consolidating `teamChatFlowStore.ts` remaining duplication

**Problem:** `chatFlowBase.ts` (700 lines) already extracts shared logic (`processToolCalls`, `saveAssistantToolCallMessage`, `saveFinalResponse`, `parseRawToolCalls`, `executeStreamCall`, `buildConversationContext`), and `teamChatFlowStore.ts` already consumes these helpers (lines 37-40, 640-696). However, `streamLeaderTurn()` (lines 730-797) duplicates the stream-call pattern with team-specific tool injection (delegate tool) that could be composed from the shared primitives.

**Plan:**
- Audit remaining duplication between `teamChatFlowStore.ts` and `chatFlowStore.ts`:
  - `streamLeaderTurn()` (lines 730-797): local stream call with delegate tool injection
  - Inline message-saving logic in event handlers (lines 230-260, 308-324)
- Extract composable stream-call wrapper in `chatFlowBase.ts` that accepts optional extra tools
- Refactor `streamLeaderTurn` to use the shared wrapper instead of duplicating `executeStreamCall` + `buildConversationContext` inline
- **Do NOT introduce a new abstraction layer** — extend the existing `chatFlowBase.ts` module

**Affected files:** 2 files (`chatFlowBase.ts`, `teamChatFlowStore.ts`)
**Risk:** Medium-High — core chat functionality
**Regression matrix:**
- Solo chat: send message, streaming, tool execution, regenerate
- Solo chat: bootstrap flow, pre-compact flush
- Team chat: delegation, agent stream, synthesis completion
- Team chat: tool approval/rejection, abort mid-run
- Both: persisted message reload after page refresh
**Mitigation:** Run full test suite before and after; manual testing per regression matrix above
**Rollback:** Commit-granular git revert (one commit per logical change)

---

## Phase 3: Frontend — Component Refinements (Priority: Medium)

### 3A. Extract `ToolCallContext` for chat message prop drilling

**Problem:** `ChatMessage → ToolRunBlock → ToolCallBubble → ToolResultDetail` passes props through 3+ levels.

**Plan:**
- Create a React Context `ToolCallContext` providing tool run state
- Components subscribe to context instead of receiving tunneled props
- Alternative: components directly subscribe to `useToolRunStore`

**Affected files:** 4 component files
**Risk:** Low

### 3B. Stabilize `conversationStore.ts` internal APIs (prerequisite for future split)

**Problem:** `conversationStore.ts` (387 lines) mixes CRUD, learning mode, consolidation, and lifecycle orchestration. However, it also coordinates side effects across stores (`selectConversation` triggers vault/memory/skill/debug/summary loading, lifecycle events, and consolidation at lines 154-295). Splitting it prematurely would break these coordinated flows.

**Plan (incremental, not immediate split):**
1. Extract side-effect helpers as standalone functions that accept store getters/setters
2. Add integration tests covering: `selectConversation`, `openAgentChat`, `openTeamChat`, `startNewAgentConversation`
3. **Defer** the actual store split until integration tests provide sufficient coverage
4. Document which internal APIs are stable enough for external consumers

**Affected files:** `conversationStore.ts` + new test file
**Risk:** Low (no store split in this phase)
**Rationale:** 24 consuming files use this store (verified via `rg -l`); splitting without tests risks silent regressions in lifecycle coordination

---

## Phase 4: Rust Backend — Split Large Files (Priority: High)

### 4A. Split `relay/db.rs` (1,300 lines) into submodules

**Problem:** 40+ functions handling contacts, threads, messages, and outbox in a single file.

**Plan:**
- Create `relay/db/` directory with:
  - `mod.rs` — re-exports
  - `contacts.rs` — contact CRUD (~350 lines)
  - `threads.rs` — thread operations (~250 lines)
  - `messages.rs` — message CRUD + queries (~350 lines)
  - `outbox.rs` — outbox management (~200 lines)
- Move corresponding tests into each file's `#[cfg(test)]` module
- Re-export all public items from `relay/db/mod.rs` to maintain API compatibility

**Affected files:** 1 → 5 Rust files
**Risk:** Low — re-exports maintain backward compatibility
**Verification:** `cargo test` must pass with all existing relay/db tests

### 4B. Split `conversation_ops.rs` (1,073 lines)

**Problem:** Mixes conversation CRUD, summaries, and memory consolidation.

**Plan:**
- Extract `db/operations/summary_ops.rs` — summary creation/retrieval
- Extract `db/operations/consolidation_ops.rs` — memory consolidation logic
- Keep conversation CRUD in `conversation_ops.rs`
- Re-export from `db/operations/mod.rs`

**Affected files:** 1 → 3 Rust files
**Risk:** Low

### 4C. Refactor `tool_commands/execution.rs` (738 lines)

**Problem:** Tool dispatcher mixes dispatch orchestration with timeout logic, logging, and scope validation.

**Plan:**
- Extract `tool_commands/dispatcher.rs` — pure dispatch logic (match tool name → handler)
- Keep execution orchestration (timeouts, logging, scope) in `execution.rs`
- Result: each file ~350-400 lines

**Affected files:** 1 → 2 Rust files
**Risk:** Low

---

## Phase 5: Rust Backend — Reduce Duplication & Improve Patterns (Priority: Medium)

### 5A. Standardize relay DB row mappers (scoped to relay subsystem)

**Problem:** `relay/db.rs` has 4 separate `map_*_row()` functions (`map_contact_row`, `map_thread_row`, `map_message_row`, `map_outbox_row`) with identical positional `row.get(N)?` patterns. Similar patterns exist in `team_operations.rs` and `cron_operations.rs`.

**Plan (scoped to relay DB first):**
- Add column constant strings (like `team_operations.rs` already does at lines 12-22) to the new relay/db submodules
- Introduce local `row_to_*` helper methods on each struct using named columns where rusqlite supports it
- Evaluate expanding to other subsystems only after relay DB proves the pattern works

**Affected files:** 4 relay/db submodule files (from Phase 4A)
**Risk:** Low — scoped to one subsystem
**Note:** A global `FromRow` trait or derive macro is deferred until the local pattern is validated

### 5B. Refactor `AppError` with `thiserror` (already a dependency)

**Problem:** `AppError` variants store bare `String` messages, losing root cause information. Note: `thiserror` is already in `Cargo.toml`, and `DbError` already derives it (`db/error.rs:2`). `AppError` intentionally serializes to a plain string at the Tauri command boundary (`error.rs:7-9`).

**Plan:**
- Refactor `AppError` to use `#[error]` attributes from thiserror (already available)
- Add `source()` chain where applicable for debugging
- **Critical constraint:** Preserve the existing custom `Serialize` impl that outputs plain strings — the frontend depends on this contract
- Add explicit tests verifying serialized output compatibility: `assert_eq!(serde_json::to_string(&err), expected_string)`

**Affected files:** `error.rs` + error conversion sites
**Risk:** Low — thiserror already available, additive improvement

### 5C. Split `BrowserManager` responsibilities (960 lines)

**Problem:** Session management, sidecar lifecycle, domain approval, screenshot, proxy, and security all in one struct.

**Plan:**
- Extract `browser/session.rs` — session CRUD, active session tracking
- Extract `browser/sidecar.rs` — process lifecycle management
- Extract `browser/security.rs` — domain approval, policy enforcement
- Keep `browser/mod.rs` as coordinator (~300 lines)

**Affected files:** 1 → 4 Rust files
**Risk:** Medium — sidecar lifecycle is complex

### 5D. Split `team_orchestrator.rs` (1,047 lines)

**Problem:** Task creation, LLM streaming, report handling, and result synthesis mixed in one impl.

**Plan:**
- Extract `services/team_tasks.rs` — task creation and tracking
- Extract `services/team_synthesis.rs` — result aggregation and synthesis
- Keep orchestration flow in `team_orchestrator.rs`

**Affected files:** 1 → 3 Rust files
**Risk:** Medium — async orchestration logic is complex

---

## Phase 6: Vault Index Optimization for External Mutations (Priority: Low)

**Problem:** `VaultManager` already performs incremental index updates on its own CRUD operations (register at `manager.rs:280`, update at `manager.rs:462`, delete at `manager.rs:523`). However, full `rebuild_index()` is still triggered for:
- Note renames requiring link re-resolution (`manager.rs:472`)
- External file-tool mutations via `rebuild_vault_index()` in `file_tools.rs:208`

**Plan:**
- For external `write_file`/`delete_file` tool mutations: add targeted `register`/`unregister` + link update calls instead of full rebuild
- For renames: replace full `rebuild_index()` at `manager.rs:472` with targeted invalidation:
  1. Update `name_to_ids` mapping (already done at `manager.rs:471`)
  2. Reclassify links that referenced the old filename as broken (scan `link_index.outgoing` for `raw_link` matching old name)
  3. Run `try_resolve_broken_links` with the new filename to resolve any previously-broken links
  - **Note:** This is targeted invalidation, not old-name preservation — wikilinks using the old name become broken (matching the current behavior where full rebuild also reclassifies them)
- Keep full `rebuild_index()` for startup and manual rebuild (unchanged)

**Affected files:** `commands/tool_commands/file_tools.rs`, `vault/links.rs`, `vault/manager.rs`
**Risk:** Medium — link consistency must be maintained
**Verification:** Existing vault tests must pass; add targeted tests for rename + external mutation scenarios

---

## Execution Order & Dependencies

```
Phase 1 (Hooks)        ─── independent, start immediately
Phase 2A (NetworkSettings) ─── depends on Phase 1A (uses useLoadOnOpen)
Phase 2B (ChatFlow)    ─── independent of Phase 1, can run in parallel
Phase 3                ─── independent of Phase 1/2
Phase 4 (Rust splits)  ─── independent of frontend phases, can run in parallel
Phase 5A (row mappers) ─── depends on Phase 4A (relay/db split)
Phase 5B (AppError)    ─── independent of Phase 4, can run in parallel with 4
Phase 5C (Browser)     ─── independent of Phase 4, can run in parallel with 4
Phase 5D (Team orch)   ─── independent of Phase 4, can run in parallel with 4
Phase 6                ─── independent, lowest priority
```

**Recommended parallel tracks:**
- Track A (Frontend): Phase 1 → Phase 2A → Phase 3
- Track B (Frontend): Phase 2B (can start immediately)
- Track C (Rust): Phase 4A/4B/4C + Phase 5B/5C/5D in parallel (no coupling)
- Track D (Rust): Phase 5A (after Phase 4A completes)
- Track E (Rust): Phase 6 (lowest priority, independent)

## Testing Strategy

- **Before each phase:** Run `npm test` and `cargo test --workspace` to establish baseline
- **After each phase:** Run full test suite; fix any regressions before proceeding
- **Phase 2B regression matrix (ChatFlow):**
  - Solo: send message, streaming response, tool execution (approve/reject), regenerate
  - Solo: bootstrap flow, pre-compact flush, abort mid-stream
  - Team: delegation dispatch, agent streaming, synthesis completion
  - Team: tool approval/rejection, abort mid-run, persisted reload
- **Phase 4A (relay/db):** All existing relay/db tests must pass unchanged
- **Phase 5B (AppError):** Add explicit serialization compatibility tests before refactoring
- **Rollback strategy:** Each phase is one or more atomic commits; rollback = git revert of specific commits (not a single monolithic revert)
- **No new features** — all changes are pure refactoring; external behavior must be identical

## Success Criteria

Success criteria are scoped to the files explicitly addressed in Phases 1-5:

- **Files addressed by this plan** are under 600 lines (Rust) or 300 lines (React components):
  - `relay/db.rs` → 4 submodules each <350 lines
  - `conversation_ops.rs` → 3 files each <400 lines
  - `execution.rs` → 2 files each <400 lines
  - `NetworkSettingsPanel.tsx` → orchestrator <150 lines + 5 sections each <150 lines
- Remaining leader-only duplication in `teamChatFlowStore.ts` consolidated into `chatFlowBase.ts`
- All existing tests pass after each phase
- `useLoadOnOpen` and `useClipboardFeedback` hooks eliminate 3+ duplicated patterns each
- Relay DB row mappers use column constants (standardized pattern)

**Out of scope (not targeted for size reduction in this plan):**
- `cron_operations.rs` (915 lines), `agent_commands.rs` (907 lines), `relay_client.rs` (842 lines)
- `team_operations.rs` (712 lines), `vault/manager.rs` (737 lines), `vault/links.rs` (667 lines)
- `OnboardingScreen.tsx` (403 lines)
- `/src/services/` directory reorganization (deferred — broad import churn without behavioral payoff)
