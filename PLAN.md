# CSS Design System Unification Plan

## Goal
하드코딩된 hex 색상값을 CSS 변수로 통일하고, 정의되지 않은 변수를 정리하며, 반복되는 UI 패턴을 공통 클래스로 통합하여 전체 UI 일관성을 확보한다.

> **범위**: CSS 파일 내 hex 색상(`#RRGGBB` 형식)의 토큰화. CSS keyword 색상(`white`, `transparent` 등)과 TSX 인라인 색상은 이번 범위에서 제외한다.

## Current State
- `base.css`: `:root`에 주요 시맨틱 변수 추가 완료 (`--danger`, `--success`, `--warning`, `--focus-ring` 등). 일부 하드코딩 색상 → 변수 교체 완료. Phase 1-1의 추가 토큰(`--text-light`, `--info` 등)은 미반영
- `chat.css`, `layout.css`: 부분 토큰화 진행. 하드코딩 hex ~20건, 미정의 변수(`--text-secondary`, `--accent-color`, `--bg-hover`, `--border-color` 등) 잔존
- 나머지 7개 파일(`network.css`, `agent.css`, `settings.css`, `team.css`, `vault.css`, `onboarding.css`, `debug.css`): ~120건의 하드코딩 색상 잔존
- 14개 이상의 정의되지 않은 CSS 변수가 10개 파일에서 참조됨
- 아이콘 버튼, 배지 등 유사 패턴이 파일별로 중복 구현됨

## Design Principles
1. **변수 우선**: 모든 색상은 `:root` 변수를 통해 참조
2. **기존 구조 유지**: 파일 분리 구조(파일당 컴포넌트)는 변경하지 않음
3. **점진적 적용**: 기능 변경 없이 스타일 값만 교체
4. **멱등성 보장**: 자동화 스크립트는 반복 실행해도 안전
5. **Phase별 커밋**: 각 Phase를 별도 커밋으로 분리 (롤백 시 의존 순서 주의 — Rollback Strategy 참조)

---

## Phase 1: CSS 변수 정리 (base.css)
> 커밋 단위: 1개

### 1-1. 누락 변수 추가
`:root`에 다음 변수를 추가한다:

```css
--text-light: #94a3b8;
--success-bg: #dcfce7;
--success-hover: #22c55e;
--warning-text: #d97706;
--warning-border: #fde68a;
--warning-dark: #b45309;
--code-text: #e11d48;
--info: #3b82f6;
--info-bg: #dbeafe;
--info-border: #93c5fd;
```

**`#94a3b8` 처리**: `--text-muted`(`#64748b`)와 다른 톤이므로 `--text-light`로 별도 변수 정의. 기존 `--text-muted` 교체가 아닌 새 토큰으로 관리.

### 1-2. 정의되지 않은 변수 매핑 정리
다음 미정의 변수를 실제 사용처에서 올바른 변수로 교체한다:

| 미정의 변수 | 교체 대상 | 사용 파일 |
|------------|----------|----------|
| `--text-primary` | `--text-main` | chat.css, team.css, layout.css |
| `--text-secondary` | `--text-muted` | chat.css, settings.css, team.css, layout.css, debug.css |
| `--text-color` | `--text-main` | layout.css |
| `--text` | `--text-main` | chat.css, settings.css, debug.css |
| `--accent-bg` | `--focus-ring` | chat.css |
| `--accent-color` | `--primary` | chat.css |
| `--warning-color` | `--warning-text` | chat.css |
| `--error` | `--danger` | settings.css |
| `--bg-hover` / `--hover` | `--hover-bg` | chat.css, layout.css, agent.css, debug.css |
| `--bg-secondary` | `--bg-color` | chat.css |
| `--bg-tertiary` | `--hover-bg` | team.css |
| `--border-secondary` | `--border` | team.css |
| `--border-color` | `--border` | chat.css (line 746) |

**방법**: 각 파일에서 `grep`으로 해당 변수 사용처를 찾아 수동으로 교체한다. fallback 값이 있는 경우(`var(--accent-bg, #eef2ff)`)는 전체 `var()` 표현을 교체한다.

---

## Phase 2: 전체 파일 색상 토큰화
> 커밋 단위: 1개

### 대상 파일 및 순서
Phase 1에서 변수 정의 및 미정의 변수 정리 후, **모든** CSS 파일의 잔존 하드코딩 hex를 교체한다:
1. `chat.css` (~20건 잔존)
2. `layout.css` (~5건 잔존)
3. `network.css` (~30건)
4. `agent.css` (~20건)
5. `settings.css` (~15건)
6. `team.css` (~12건)
7. `vault.css` (~6건)
8. `onboarding.css` (1건)
9. `debug.css` (~5건)

### 교체 매핑 테이블 (전체 스캔 기반)

| Hex | CSS Variable | 비고 |
|-----|-------------|------|
| `#ef4444` | `var(--danger)` | 16건 |
| `#dc2626` | `var(--danger-hover)` | 4건 |
| `#fef2f2` | `var(--danger-bg)` | 7건 |
| `#fee2e2` | `var(--danger-bg-hover)` | 2건 |
| `#fecaca` | `var(--danger-border)` | 3건 |
| `#f87171` | `var(--danger)` | 근사치, 1건 |
| `#fca5a5` | `var(--danger-border)` | 근사치, 1건 |
| `#e53e3e` | `var(--danger)` | 근사치, 1건 |
| `#22c55e` | `var(--success-hover)` | 10건 |
| `#16a34a` | `var(--success-text)` | 4건 |
| `#dcfce7` | `var(--success-bg)` | 2건 |
| `#f0fdf4` | `var(--success-bg)` | 근사치, 1건 |
| `#f59e0b` | `var(--warning)` | 3건 |
| `#eab308` | `var(--warning)` | 근사치, 2건 |
| `#d97706` | `var(--warning-text)` | 1건 |
| `#ca8a04` | `var(--warning-dark)` | 1건 |
| `#b45309` | `var(--warning-dark)` | 1건 |
| `#92400e` | `var(--warning-dark)` | 1건 |
| `#e6a817` | `var(--warning)` | 근사치, 1건 |
| `#fde68a` | `var(--warning-border)` | 2건 |
| `#fef3c7` | `var(--warning-bg)` | 4건 |
| `#fef9c3` | `var(--warning-bg)` | 근사치, 1건 |
| `#fffbeb` | `var(--warning-bg)` | 1건 |
| `#eef2ff` | `var(--focus-ring)` | 10건 |
| `#e0e7ff` | `var(--focus-ring)` | 근사치, 2건 |
| `#6366f1` | `var(--primary)` | 1건 |
| `#3b82f6` | `var(--info)` | 2건 |
| `#2563eb` | `var(--info)` | 근사치, 1건 |
| `#dbeafe` | `var(--info-bg)` | 1건 |
| `#93c5fd` | `var(--info-border)` | 1건 |
| `#94a3b8` | `var(--text-light)` | 4건 |
| `#64748b` | `var(--text-muted)` | 2건 |
| `#f1f5f9` | `var(--code-bg)` | 3건 |
| `#cbd5e1` | `var(--disabled)` | 해당 없음 (이미 처리됨 확인) |
| `#e11d48` | `var(--code-text)` | 해당 없음 (chat.css에만 존재, 이미 처리됨 확인) |

**제외 (자동 치환 안 함)**:
| Hex | 이유 |
|-----|------|
| `#fff` | 3건, 단축형 — 수동 확인 후 `var(--surface)` 가능성 |
| `#c7d2fe` | 1건, primary gradient — 사용 빈도 낮아 유지 |
| `#22c55e80` | 1건, 알파값 포함 — rgba 범주 |
| `#fafafa` | `--bg-color(#f8fafc)`와 유사하지만 다른 톤 — 수동 판단 |

### rgba() 색상 처리 전략
자동 치환 범위에서 제외하되, 수동 처리 대상을 명시한다:

| rgba 사용처 | 파일 | 처리 방침 |
|------------|------|----------|
| `rgba(99, 102, 241, 0.2)` (primary shadow) | network.css, chat.css | 유지 — shadow 전용, 테마 전환 시 재검토 |
| `rgba(99, 102, 241, 0.06)` (primary tint) | layout.css, vault.css | 유지 — 매우 연한 배경, 변수화 이점 낮음 |
| `rgba(34, 197, 94, 0.35/0.08)` (success) | settings.css | 유지 — 조건부 스타일 |
| `rgba(239, 68, 68, 0.3/0.08/0.1)` (danger) | settings.css, base.css | 유지 — 조건부 스타일 |
| `rgba(255, 255, 255, 0.8)` | layout.css | 유지 — backdrop |

> 다크 모드 구현 시 rgba() 값을 CSS custom property로 전환하는 별도 작업 필요

### 방법
- `modify_css.py`를 확장하여 대상 파일 목록에 나머지 파일 추가
- Phase 1-1의 누락 변수(`--text-light`, `--info` 등)는 `base.css`에 직접 수동 추가 (스크립트의 `--warning` sentinel 가드에 의존하지 않음)
- `update_other_css()` 함수에도 `:root` 변수 정의 행 skip 로직 추가 (현재는 `update_base_css()`에만 존재. `content.replace()` 대신 line-by-line 처리로 변경)
- 근사치 매핑은 스크립트 실행 후 시각적으로 검증

### 검증
- 빌드(`npm run build`) 및 테스트(`npm test`) 성공 확인
- 멱등성 테스트: 스크립트 2회 실행 후 diff 없음 확인
- 잔존 하드코딩 검사 (verify.sh 사용 — Phase 4 참조)

---

## Phase 3: 공통 UI 패턴 통합
> 커밋 단위: 1개 (CSS + JSX 함께)

### 3-1. 아이콘 버튼 통합
**현재 상태**: `.icon-btn`이 `base.css`에 정의됨 (32x32, 투명 배경, hover 시 `--hover-bg`).

**통합 대상 (아이콘 전용만):**
| 클래스 | 파일(CSS) | 파일(JSX) | 특수 동작 |
|--------|----------|----------|----------|
| `.delete-btn` | layout.css | Sidebar.tsx:157 | `display: none`, 부모 hover 시 `display: block` |
| `.team-back-btn` | team.css | TeamChatWindow.tsx:77 | 없음 |
| `.vault-editor-toolbar button` | vault.css | (vault editor) | 없음 |

**통합 제외:**
| 클래스 | 이유 |
|--------|------|
| `.cred-action-btn` | 텍스트 버튼(삭제확인 "예"/"아니오")도 포함 — icon/text 혼용 |
| `.agent-delete-btn` | 아이콘+텍스트 조합 버튼 |

**방법**:
1. JSX에서 기존 클래스에 `.icon-btn` 추가: `className="icon-btn delete-btn"`
2. CSS에서 `.icon-btn`과 중복되는 속성(display, align, border, background, cursor, transition) 제거
3. `.delete-btn`의 `display: none` / hover 시 `display: block` 등 **특수 동작은 시맨틱 클래스에 유지**

**대상별 유지할 override:**
| 대상 | 유지 속성 | JSX 수정 |
|------|----------|----------|
| `.delete-btn` (layout.css) | `display: none`, 부모 hover 시 `display: block`, hover 시 `color: var(--danger)` + `background: var(--danger-bg)` | `Sidebar.tsx:157` — `className="icon-btn delete-btn"` |
| `.team-back-btn` (team.css) | 기본 `.icon-btn`과 동일, override 없음 | `TeamChatWindow.tsx:77` — `className="icon-btn team-back-btn"` |
| `.vault-editor-toolbar button` (vault.css) | `width: 28px; height: 28px` (소형), 현재 클래스 없으므로 `.icon-btn.icon-btn-sm` 추가 | `NoteEditorToolbar.tsx:23` — 각 `<button>`에 `className="icon-btn icon-btn-sm"` |

### 3-2. 배지 패턴 통합 검토
각 배지의 padding, border-radius, font-size, text-transform을 비교하여 **동일한 구조(padding, radius, font-size)를 공유하는 3개 이상의 배지**가 있을 경우에만 `.badge` 베이스 클래스를 추출한다. 시맨틱 클래스는 유지하고, 색상만 modifier로 분리.

**후보 셀렉터:**
| 셀렉터 | 파일 | padding | radius | font-size |
|--------|------|---------|--------|-----------|
| `.team-role-badge` | team.css:377 | 2px 8px | 12px | 0.7rem |
| `.network-status-badge` | network.css:179 | 2px 8px | 12px | 0.7rem |
| `.vault-category-chip` | vault.css:285 | 2px 10px | 12px | 0.75rem |
| `.tool-badge` | chat.css:599 | 2px 6px | 4px | 0.65rem |

> 동일 구조 3개 미만이면 통합하지 않고 현행 유지 (no-op).

### 3-3. Focus ring 패턴 통일
- 하드코딩 `#eef2ff` → `var(--focus-ring)` 교체 (Phase 2에서 처리됨)
- focus ring 두께는 컨텍스트에 따라 2px/3px 혼용 허용
- 이미 shadow와 조합된 경우 기존 패턴 유지

---

## Phase 4: 검증 및 정리
> 커밋 단위: 1개 (verify.sh 추가 + modify_css.py 정리)

### 4-1. 검증 스크립트 (`verify.sh`)
Phase별 수동 grep 대신, 종합 검증 스크립트를 작성한다:

```bash
#!/bin/bash
set -e

echo "=== 1. Build & test ==="
npm run build
npm test

echo "=== 2. Remaining hardcoded hex colors ==="
# 3/6/8자리 hex 검사, 변수 정의 행 제외
grep -rnE '#[0-9a-fA-F]{3,8}\b' src/styles/*.css \
  | grep -vE '^[^[:space:]]+:[[:digit:]]+:[[:space:]]*--[a-zA-Z0-9_-]+[[:space:]]*:' \
  || echo "None found"

echo "=== 3. Undefined CSS variables (used - defined) ==="
DEFINED=$(grep -ohE '\-\-[a-zA-Z0-9_-]+[[:space:]]*:' src/styles/*.css | sed 's/[[:space:]]*://' | sort -u)
USED=$(grep -ohE 'var\(\-\-[a-zA-Z0-9_-]+' src/styles/*.css | sed 's/var(/-/' | sed 's/^-//' | sort -u)
UNDEF=$(comm -23 <(echo "$USED") <(echo "$DEFINED"))
if [ -z "$UNDEF" ]; then
  echo "All variables defined"
else
  echo "$UNDEF"
fi
```

> **멱등성 테스트**는 `modify_css.py` 삭제 전에 별도로 수행한다: `cp -r src/styles /tmp/backup && python3 modify_css.py && diff -r /tmp/backup/styles src/styles`. verify.sh에는 포함하지 않아 스크립트 삭제 후에도 verify.sh가 독립 동작한다.

### 4-2. 스모크 테스트 매트릭스
빌드 후 다음 화면/상태를 육안 확인:

| 화면 | 확인 항목 |
|------|----------|
| **채팅** | 메시지 버블, 입력 focus ring, 전송/취소 버튼, tool call 결과 |
| **사이드바** | active 메뉴, 대화 삭제 버튼 hover, 배지 |
| **에이전트 설정** | 삭제 CTA, 경고 배지, 비용 레벨 표시 |
| **네트워크** | 연결 상태 dot(online/offline), 승인/거부 버튼, 배너 |
| **팀** | 역할 배지, 뒤로가기 버튼, 채팅 헤더 |
| **볼트** | 카테고리 칩, 에디터 툴바, 노트 삭제 |
| **설정** | 자격증명 관리, locale/credential flow, 토글 스위치 |
| **온보딩** | 에러 메시지 표시 |
| **디버그 패널** | 텍스트 색상, hover 상태 |

### 4-3. 정리
- `modify_css.py`: 멱등성 테스트 완료 후 삭제. verify.sh는 이 스크립트에 의존하지 않음
- `verify.sh`: hex 잔존 + 미정의 변수 검사 전용. CI 활용 가능성을 고려하여 유지 또는 삭제 판단

---

## Scope Exclusions
- **다크 모드**: 이번 작업 범위에 포함하지 않음. 변수화가 완료되면 이후 `:root[data-theme="dark"]`로 확장 가능
- **CSS-in-JS 전환**: 현재 plain CSS 구조를 유지
- **rgba() 색상 자동화**: Phase 2의 rgba 전략 참조 — 수동 판단 필요, 다크 모드 시 재검토
- **인라인 TSX 색상**: 다음 파일의 인라인 색상/미정의 변수는 이번 범위에서 제외. 이유: 프로그래밍 방식으로 색상을 사용하거나 외부 라이브러리(D3)와 통합되어 있어 CSS 변수 적용이 복잡
  - `GraphCanvas.tsx` (D3 시각화)
  - `NativeToolPanel.tsx`
  - `SettingsModal.tsx`
  - `ChatWindow.tsx`
  - `MainLayout.tsx` (인라인 스타일의 미정의 변수)
  - `DebugPanel.tsx` (인라인 스타일)
- **CSS keyword 색상**: `white`, `transparent` 등 CSS keyword 색상은 이번 범위에서 제외
- **`#c7d2fe`**: primary gradient 용도, 1건만 사용 — 유지
- **`#22c55e80`**: 알파값 포함 hex — rgba 범주로 수동 처리

## Rollback Strategy
- 모든 변경은 `css-design-system` 브랜치에서 진행
- Phase 1, 2, 3, 4를 각각 별도 커밋으로 분리
- **의존 관계**: Phase 2는 Phase 1의 `:root` 토큰에 의존. Phase 3은 Phase 1-2와 독립
- **롤백 순서**: Phase 2를 먼저 revert한 후 Phase 1을 revert해야 함. 역순 revert 시 미정의 변수 참조 발생
- Phase 3(JSX 변경)은 Phase 1-2(CSS only)와 독립적으로 롤백 가능
- Phase 4(verify.sh)는 단독 롤백 가능

## Risk
- **시각적 회귀**: 근사치 매핑으로 미세한 색상 차이 발생 가능 → 스모크 테스트 매트릭스로 검증
- **`#94a3b8` 문제 해소**: `--text-light` 별도 변수로 정의하여 `--text-muted`와의 톤 차이 방지
- **`modify_css.py` 안전성**: `:root` 정의부 skip 로직 + 멱등성 테스트로 검증
- **JSX 변경 누락**: Phase 3 대상 컴포넌트 목록을 명시하여 누락 방지
- **`.cred-action-btn` 오통합 방지**: 텍스트 버튼 혼용으로 `.icon-btn` 통합 대상에서 제외
