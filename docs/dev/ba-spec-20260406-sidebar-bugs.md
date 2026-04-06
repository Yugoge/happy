# BA Specification: 5 Sidebar Bugs

**Request ID**: dev-20260406-sidebar-bugs
**Created**: 2026-04-06T09:00:00Z

## Goal

Fix 5 distinct bugs in the sidebar and related tool views: AskUserQuestion answer persistence, Todo color scheme, sidebar scroll position on push/pop, subagent todo update visibility, and disabling interaction on nested tool views.

## Context

The sidebar (`SidebarAgentConversation`) renders Agent/Task child messages with push/pop navigation via `rightSidebarStore`. Several components used within the sidebar have rendering, state persistence, and interaction bugs.

## Requirements (MoSCoW)

### Must Have

1. **Bug 1 -- AskUserQuestion selected answer disappears on re-entry**
   - Root cause: `AskUserQuestionView.tsx:271-273` tries to recover saved answers from `(tool.result as any)?.answers` or `(tool.permission as any)?.answers`. The `answers` record is sent via `sessionAllow()` as part of the permission RPC (`ops.ts:326-327`), but the CLI side does NOT store this back into `tool.result`. The `tool.result` for AskUserQuestion after completion is whatever Claude SDK returns (likely just a string or null), NOT the answers record. The `tool.permission` object on the app side also does not persist `.answers` after the permission is resolved -- it only has `id`, `status`, etc.
   - Fix: The answers must be persisted somewhere that survives component remount. Options: (a) store answers in the permission object server-side and ensure they round-trip, (b) store answers in `tool.result` by having the CLI write them back, or (c) extract answers from the `reason` text field of the permission (which IS persisted as `responseText` in `handleSubmit`). Option (c) is simplest: parse the `reason` field (format: `"Header1: Label1\nHeader2: Label2"`) to recover answers on remount.

2. **Bug 2 -- Todo color rendering issues**
   - Root cause in `TodoView.tsx`: uses `theme.colors.typography` (line 89) which DOES NOT EXIST in `theme.ts`. The theme only has `theme.colors.text`. This causes the default todo text color to be `undefined` (renders as black/default). Additionally, `inProgressText` uses `theme.colors.warning` which is `#8E8E93` (gray), not blue as requested.
   - Root cause in `SidebarTodoView.tsx`: same `theme.colors.typography` issue (line 79). Also, `completedText` is styled with `theme.colors.textSecondary` (gray) + strikethrough, not green. Only `iconCompleted` is green. `inProgressText` style is not applied at all -- only `completedText` is conditionally applied (line 44-46). No `inProgressText` or `pendingText` style is applied to sidebar todo text.
   - Required color mapping:
     - completed: GREEN text + GREEN icon (use `theme.colors.success`)
     - in_progress: BLUE text + BLUE icon (use `theme.colors.radio.active` = `#007AFF`)
     - pending: DARK GRAY text + DARK GRAY icon (use `theme.colors.text` for text, `theme.colors.textSecondary` for icon)
   - Fix `TodoView.tsx`: change `typography` to `text`, change `inProgressText` color from `warning` to `radio.active`, change `iconInProgress` color from `warning` to `radio.active`, change `pendingText` to `theme.colors.text`
   - Fix `SidebarTodoView.tsx`: add conditional styles for `inProgressText` and `pendingText`, fix `completedText` to use `success` not `textSecondary`, fix `text` base color from `typography` to `text`, fix `iconInProgress` from `warning` to `radio.active`

3. **Bug 3 -- Sidebar scroll position resets on push/pop**
   - Root cause: `SidebarAgentConversation.tsx:107` uses a plain `<ScrollView>` without any scroll position preservation. When `pop()` is called in `rightSidebarStore.ts:33-40`, it restores the previous `SidebarData` but the `SidebarAgentConversation` component re-mounts or re-renders from scratch, resetting scroll to top.
   - The `rightSidebarStore.ts` history entries (`SidebarData`) have no `scrollY` field.
   - Fix: Add `scrollY: number` to `SidebarData`. Before push, capture current scroll position via `ScrollView.onScroll` and store it. After pop, restore scroll position via `scrollTo()` in a `useEffect`.

4. **Bug 5 -- Disable interaction on rendered elements inside sidebar**
   - Root cause: In `SidebarAgentConversation.tsx:30-31`, `ChildToolBlock` passes both `onPress` and `onContentPress` to `ToolView`. The `onContentPress` wraps the specialized view content in a `TouchableOpacity` (ToolView.tsx:99-109). This makes content areas like Edit diffs, Todo lists, etc. clickable -- they push a new sidebar entry when tapped. However for non-navigable content (Edit diffs, Todos), this push navigation is confusing because it just shows the same content again in a new sidebar level.
   - Fix: Remove `onContentPress` from `ChildToolBlock` in `SidebarAgentConversation.tsx`. Only keep `onPress` for header-level navigation. Content areas should not be independently clickable in the sidebar. Alternatively, wrap content in `<View pointerEvents="box-none">` to allow text selection but prevent press handlers.

### Should Have

5. **Bug 4 -- Subagent todo updates not reflected in sidebar**
   - Analysis: Each `tool-call` message for TodoWrite contains its own `tool.input.todos` snapshot. The sidebar renders each TodoWrite call independently via `ChildToolBlock` -> `ToolView` -> `TodoView`. This is actually correct behavior -- each TodoWrite IS a distinct call with its own state.
   - However, the user expectation is to see only the LATEST todo state, not all intermediate states.
   - Fix approach: In `SidebarAgentConversation.tsx`, detect consecutive TodoWrite calls and only render the LAST one. Or add visual indicator (e.g., muted/collapsed style) for superseded TodoWrite calls. This requires filtering `messages` array before rendering.

### Won't Have (Non-Goals)

- Rewriting the sidebar navigation architecture
- Adding full-screen scroll virtualization
- Persisting scroll position across sidebar close/reopen (only push/pop)
- Server-side changes to store AskUserQuestion answers

## Edge Cases & Risks

- Bug 1: If `reason` text format changes, answer recovery breaks. Consider storing answers as JSON in a dedicated field.
- Bug 2: `theme.colors.typography` is used in exactly 2 files. Changing to `theme.colors.text` is safe but verify no other files reference it.
- Bug 3: `onScroll` fires frequently -- must throttle or use `scrollEventThrottle` prop.
- Bug 4: Filtering TodoWrite may hide useful intermediate states if user wants to see progression.
- Bug 5: Removing `onContentPress` means users can no longer drill into sub-tool details by tapping content. Must verify that header press still works for navigation.

## Acceptance Criteria

### AC1: AskUserQuestion answer persistence
- GIVEN a completed AskUserQuestion tool with a selected answer
- WHEN the user leaves and re-enters the conversation
- THEN the previously selected answer is displayed (not "-")

### AC2: Todo colors match spec
- GIVEN a TodoWrite with completed, in_progress, and pending items
- WHEN rendered in both TodoView (main chat) and SidebarTodoView (sidebar)
- THEN completed items have GREEN text+icon, in_progress has BLUE text+icon, pending has DARK GRAY text with secondary icon color, no black text anywhere

### AC3: Sidebar scroll position preserved on pop
- GIVEN a user scrolled down in a sidebar agent conversation
- WHEN they push into a sub-tool and then pop back
- THEN the scroll position is restored to where they were before pushing

### AC4: Subagent todo shows latest state
- GIVEN multiple TodoWrite calls within a subagent conversation in sidebar
- WHEN the sidebar renders the agent conversation
- THEN only the latest TodoWrite state is prominently shown (or superseded ones are visually collapsed)

### AC5: No accidental interaction on sidebar content
- GIVEN tool content (Edit diffs, Todos, etc.) rendered inside the sidebar
- WHEN the user taps on the content area
- THEN nothing happens (no push navigation, no route change). Header tap still navigates.

## Technical Hints

- Affected files:
  - `components/tools/views/AskUserQuestionView.tsx` (Bug 1)
  - `components/tools/views/TodoView.tsx` (Bug 2)
  - `components/sidebar/SidebarTodoView.tsx` (Bug 2)
  - `stores/rightSidebarStore.ts` (Bug 3)
  - `components/sidebar/SidebarAgentConversation.tsx` (Bugs 3, 4, 5)
  - `components/tools/ToolView.tsx` (Bug 5 -- understand onContentPress flow)
  - `components/tools/ToolFullView.tsx` (Bug 2 -- TodoWrite has no fullViewRegistry entry, falls back to generic Description+Input+Output)
- `theme.colors.typography` does not exist -- replace with `theme.colors.text`
- `theme.colors.warning` = `#8E8E93` (gray) -- not suitable for in_progress
- `theme.colors.radio.active` = `#007AFF` (blue) -- correct for in_progress
- `theme.colors.success` = `#34C759` (green) -- correct for completed
- The `ToolFullView` renders TodoWrite as generic JSON since it's not in `toolFullViewRegistry`. Consider adding a `TodoViewFull` entry, or at minimum ensure the generic view respects colors.
