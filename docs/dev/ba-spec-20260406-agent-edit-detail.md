# BA Specification: Agent Inline/Full View Split + Edit Detail Cleanup

**Request ID**: dev-20260406-agent-edit-detail
**Created**: 2026-04-06T07:30:00Z

## Goal

Split the Agent/Task tool rendering into distinct inline (compact, non-expandable) and full-view (children in a styled section) modes, and remove the redundant Edit diff from the detail page registry.

## Context

The TaskView component currently serves both inline and full-view contexts identically -- it always shows an expand/collapse chevron that reveals child messages inline. This is undesirable: the inline view should be compact (status row only), while the full/detail page should show all children in a properly styled section. Additionally, the Edit detail page shows a diff view that duplicates information already present in the Input Parameters JSON section.

## Requirements (MoSCoW)

### Must Have
- M1: Remove expand/collapse (chevron + TouchableOpacity + expanded state + children rendering) from `TaskView.tsx` inline view. Keep only the compact `TaskStatusRow` (tool names + status icons) as a static, non-interactive element.
- M2: Create a `TaskViewFull` component (new file `views/TaskViewFull.tsx`) for the Agent/Task detail page. It renders ALL child messages inside a styled section matching the existing section pattern in `ToolFullView.tsx` (icon + title header + bordered container).
- M3: Update `toolFullViewRegistry` in `views/_all.tsx`: replace `Task: TaskView` and `Agent: TaskView` with `Task: TaskViewFull` and `Agent: TaskViewFull`.
- M4: Remove `Edit: EditViewFull` from `toolFullViewRegistry` in `views/_all.tsx` so Edit falls through to the generic layout (Description + Input + Output).

### Should Have
- S1: The section header in TaskViewFull should use an appropriate icon (e.g., `layers-outline` or `git-branch-outline`) and a translatable title (add `tools.fullView.subTools` or similar key to all language files).
- S2: Reuse existing `ChildMessageBlock` from TaskView.tsx in TaskViewFull (import it, or move to a shared location).

### Could Have
- C1: Remove the `expanded` state, `toggle` callback, chevron, and `TouchableOpacity` wrapper entirely from `TaskView.tsx` to keep the code clean.

### Won't Have (Non-Goals)
- No changes to how child messages are fetched or structured
- No changes to the inline view registries (`toolViewRegistry`)
- No deletion of `EditViewFull.tsx` file itself (just deregister it)
- No changes to ToolFullView.tsx generic section rendering logic

## Edge Cases & Risks

- TaskViewFull receives `messages` prop from ToolFullView -- verify ToolFullView passes `messages` to specialized views (it does, line 121).
- Removing Edit from fullViewRegistry means Edit detail pages show only Description + Input + Output + empty-output/error. Verify this is sufficient (it is -- `old_string`/`new_string` are in Input JSON).
- TaskView inline with zero children: currently renders just status row with no chevron. After change, behavior is identical (no regression).

## Acceptance Criteria

### AC1: Inline TaskView has no expand/collapse
- GIVEN a session with Agent/Task tool calls displayed in the main message list
- WHEN the user views the inline TaskView
- THEN only the compact status row (tool names + status icons) is shown, with no chevron and no tap interaction to expand

### AC2: Agent detail page shows children in styled section
- GIVEN the user navigates to the detail page for an Agent/Task tool call
- WHEN the page renders
- THEN child messages (agent-text and nested tool-calls) are displayed inside a section with an icon + "Sub-tools" title header, matching the visual style of Description/Input/Output sections

### AC3: Edit detail page uses generic layout
- GIVEN the user navigates to the detail page for an Edit tool call
- WHEN the page renders
- THEN Description, Input Parameters (JSON with old_string/new_string), and Output sections are shown -- no diff view

## Technical Hints

- Affected files:
  - `packages/happy-app/sources/components/tools/views/TaskView.tsx` -- simplify to remove expand/collapse
  - `packages/happy-app/sources/components/tools/views/TaskViewFull.tsx` -- NEW file
  - `packages/happy-app/sources/components/tools/views/_all.tsx` -- update registry
- Section styling pattern: copy from `ToolFullView.tsx` lines 24-31 (sectionHeader with Ionicons + sectionTitle)
- Import `toolFullViewStyles` from `../ToolFullView` for consistent section styling
- `ChildMessageBlock` is currently a private component in TaskView.tsx -- either export it or duplicate in TaskViewFull
- Add i18n key `tools.fullView.subTools` to all 9 language files
