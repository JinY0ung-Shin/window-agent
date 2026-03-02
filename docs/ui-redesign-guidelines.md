# UI Redesign Guidelines

## Objective
- Use a product-style, modern, dark-first UI language.
- Keep medium density: compact enough for operations, readable enough for long sessions.

## Core Principles
- Prefer shared UI primitives in `src/components/ui/*` over ad-hoc styling.
- Avoid direct emoji-based UI icons in new/updated screens.
- Keep body text at `text-sm` by default; reserve `text-xs` for metadata.
- Reuse semantic surfaces (`surface-card`, `PageShell`, `PageHeader`) for visual consistency.

## Preferred Building Blocks
- Page scaffolding: `PageShell` + `PageHeader`
- Actions: `Button`
- Grouped toggles: `SegmentedControl`
- Empty state: `EmptyState`
- Modal containers: `ModalShell`
- Icons: `AppIcon`
- Agent visuals: `AvatarBadge`

## Spacing and Density
- Page padding should come from `PageShell`.
- Typical vertical rhythm: `mb-4` or `space-y-4`.
- Avoid repeating large paddings (`p-6`) unless the component truly needs it.

## Color and Feedback
- Accent color should indicate primary actions and active states.
- Use status colors only for status:
  - success: online/completed
  - warning: pending/in-progress attention
  - danger: destructive/failure
- Keep borders subtle (`border-white/[0.08]` range).

## Accessibility
- Ensure focus-visible rings on interactive controls.
- Keep touch targets at least 32px high for dense controls.
- Maintain contrast between text and surface backgrounds.
