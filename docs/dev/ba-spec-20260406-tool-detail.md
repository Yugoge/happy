# BA Specification: Unified Tool Detail View Layout

**Request ID**: dev-20260406-tool-detail
**Created**: 2026-04-06T00:00:00Z

## Goal

Make the Edit and Agent tool detail pages (the "full view" shown when clicking a tool call) render the same structured layout as the Read tool: Description + Input Parameters (JSON code block) + Output section. Currently Edit only shows a diff view and Agent only shows nested sub-tool calls, both missing the standard structured sections.

## Context

The app has a two-level tool rendering architecture:

1. **Inline view** (`ToolView.tsx`): Compact card shown inside the session message list. Uses `toolViewRegistry` in `_all.tsx`.
2. **Full/detail view** (`ToolFullView.tsx`): Shown when navigating to `/session/[id]/message/[messageId]`. Uses `toolFullViewRegistry` in `_all.tsx`.

`ToolFullView.tsx` has a generic fallback that renders Description + Input Parameters + Output + Error sections. This is what Read uses -- Read has NO entry in `toolFullViewRegistry`, so it falls through to this generic layout and renders correctly.

Edit and Agent both have entries in `toolFullViewRegistry` that point to specialized components (`EditViewFull` and `TaskView`). These specialized components completely replace the generic layout, which is why they lack the structured sections.

- `EditViewFull.tsx`: Only renders `ToolDiffView` (the red/green diff). No description, no input params JSON, no output.
- `TaskView.tsx` (used for both Task and Agent in full view): Only renders the status row with nested sub-tool calls and expand/collapse. No description, no input params JSON, no output.

## Requirements (MoSCoW)

### Must Have
- Edit detail view must show Description section (from `tool.description`) above the diff
- Edit detail view must show Input Parameters section (JSON code block of `tool.input`) above the diff
- Edit detail view must show Output section (from `tool.result`) below the diff, when state is completed
- Agent detail view must show Description section above the sub-tool list
- Agent detail view must show Input Parameters section (JSON code block of `tool.input`) above the sub-tool list
- Agent detail view must show Output section below the sub-tool list, when state is completed
- All new sections must use the same visual style as the generic fallback (Ionicons, section headers, `CodeView`)

### Should Have
- Error section when `tool.state === 'error'` (matching generic fallback behavior)
- Consistent spacing and padding matching the existing generic layout

### Could Have
- Extract a shared `ToolStructuredSections` component to avoid duplicating the Description/Input/Output rendering logic across EditViewFull, TaskView, and the generic fallback

### Won't Have (Non-Goals)
- Changes to the inline/compact tool views (ToolView.tsx / EditView.tsx)
- Changes to how Read renders (it already works correctly)
- Changes to BashViewFull (it has its own specialized terminal UI which is appropriate)
- Changes to other tool full views (MultiEditViewFull, CodexBashView, etc.)

## Edge Cases & Risks

- `tool.description` may be null/undefined for some tool calls -- sections should conditionally render (already handled in generic fallback pattern)
- `tool.input` may be empty or minimal -- should still render as JSON code block
- Agent's `tool.result` is often null (the real output is in child messages) -- Output section should only appear when result is non-null
- The diff view in EditViewFull is full-width (`sectionFullWidth` style) -- the new sections above/below should use standard `section` padding
- TaskView is shared by both `Task` and `Agent` tools -- changes affect both

## Acceptance Criteria

### AC1: Edit detail view shows structured sections
- GIVEN a completed Edit tool call with description, input, and result
- WHEN the user navigates to the Edit tool detail page
- THEN Description, Input Parameters (JSON), the diff view, and Output sections are all visible in that order

### AC2: Agent detail view shows structured sections
- GIVEN a completed Agent tool call with description and input
- WHEN the user navigates to the Agent tool detail page
- THEN Description and Input Parameters (JSON) sections appear above the sub-tool list

### AC3: Sections match visual style of Read detail view
- GIVEN Description/Input/Output sections on Edit or Agent detail views
- WHEN compared to the Read tool detail view
- THEN icons, fonts, spacing, and section header styling are identical (using same Ionicons, colors, styles from toolFullViewStyles)

### AC4: Conditional rendering works correctly
- GIVEN a tool call where description is null
- WHEN the detail page renders
- THEN the Description section is omitted (not shown as empty)

## Technical Hints

- Affected files:
  - `packages/happy-app/sources/components/tools/views/EditViewFull.tsx` -- Add structured sections around the diff
  - `packages/happy-app/sources/components/tools/views/TaskView.tsx` -- Add structured sections around the sub-tool list (only in full view context)
  - Optionally: `packages/happy-app/sources/components/tools/ToolFullView.tsx` -- Extract shared section rendering into a reusable component
- The generic fallback in `ToolFullView.tsx` (lines 33-93) is the reference implementation for section rendering
- `toolFullViewStyles` is exported from `ToolFullView.tsx` and already imported by `EditViewFull.tsx`
- `CodeView` component is used for JSON code blocks in the generic fallback
- Key challenge for TaskView: it is used in BOTH inline view (`toolViewRegistry`) AND full view (`toolFullViewRegistry`). The structured sections should only appear in full view context. The component may need a prop like `isFullView` or the full view registry entry may need to wrap TaskView with the structured sections.
- Translation keys for section headers already exist: `tools.fullView.description`, `tools.fullView.inputParams`, `tools.fullView.output`, `tools.fullView.error`, `tools.fullView.completed`, `tools.fullView.noOutput`
