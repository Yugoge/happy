# BA Specification: Sidebar Polish - Requirements 2-5

**Request ID**: dev-20260406-sidebar-polish
**Created**: 2026-04-06T09:00:00Z

## Goal

Polish the right sidebar and inline tool card behaviors for Agent conversations, sub-tool navigation, Bash terminal rendering, and Todo checkbox styling.

## Context

The right sidebar system (`RightSidebar.tsx` + `SidebarContentRenderer.tsx`) already supports opening tool details in a side panel (desktop) or modal (mobile). It dispatches to specialized renderers: `SidebarAgentConversation`, `SidebarBashView`, `SidebarFileView`, `SidebarGenericView`. The sidebar is opened via the `useRightSidebar` Zustand store when a tool's content area is clicked (`onContentPress` callback from `ToolView`). Four improvements are needed.

## Requirements (MoSCoW)

### Must Have

**R2 - Agent sidebar shows full conversation**
- Currently `SidebarAgentConversation.tsx` only renders `agent-text` and `tool-call` children. It ignores the orchestrator's prompt to the sub-agent.
- The orchestrator prompt IS available: `tool.input.prompt` contains it (from `knownTools.tsx` line 52: `prompt: z.string()`). Also `tool.input.description` is used for the title but NOT shown as content in the sidebar.
- Must show: (1) the orchestrator prompt at the top, (2) all agent-text responses, (3) all tool-call children with results, (4) todo list changes (already would appear as tool-call children if present).
- The `Message.children[]` array for Agent/Task tools contains all sub-messages: `agent-text`, `tool-call` (including nested TodoWrite, Bash, etc.). These are already iterated by `SidebarAgentConversation` but only `agent-text` and `tool-call` kinds are rendered; `agent-event` and `user-text` are dropped in the switch default. Add support for all message kinds.

**R3 - Sub-tool clicks stay in right sidebar**
- Currently `ToolView` inside `SidebarAgentConversation` renders child tool-calls using `<ToolView ... sessionId={sessionId} messageId={message.id} />`. When header is pressed, `handlePress` calls `router.push(/session/${sessionId}/message/${messageId})` which navigates the main content area.
- Must prevent navigation when inside the sidebar. Instead, clicking a sub-tool header should replace the sidebar content with that tool's detail view (or push onto a sidebar-internal stack).
- Implementation approach: pass a custom `onPress` callback to child `ToolView` components that calls `useRightSidebar.open()` with the clicked tool's data, replacing the current sidebar content. Add a back button to return to the parent agent conversation.

**R4 - Bash inline shows abbreviated content + sidebar**
- Currently `BashView.tsx` renders `CommandView` with `stdout={null}` and `stderr={null}` (line 39-40), showing only the command with no output. The content area IS wrapped in `TouchableOpacity` by `ToolView` when `onContentPress` is provided, so clicking already opens the sidebar.
- Must change: show abbreviated terminal output (first few lines of stdout/stderr) in the inline `BashView`. The click-to-sidebar behavior already works via `onContentPress`.
- Header click behavior: already goes to detail page (`/session/.../message/...`) showing `BashViewFull` which renders full terminal. This should remain unchanged.
- The detail page (`[messageId].tsx`) uses `ToolFullView` which dispatches to `BashViewFull` for Bash tools. `BashViewFull` currently shows description+input+output as full terminal. The requirement says "NO rendered terminal" on detail page - but this contradicts current behavior and would reduce functionality. Clarification assumed: keep detail page as-is, make content click open sidebar with full terminal.

**R5 - Todo sidebar + checkbox styling**
- Currently `TodoView.tsx` uses text characters for checkboxes: `'checkmark'` for completed, `'square'` for others. Styling uses green for completed with strikethrough, blue for in-progress, gray for pending.
- Must change checkbox icons: completed should use `Ionicons "checkmark-circle"` (green, same as `ToolStatusIcon` in `TaskView.tsx` line 130), in-progress should use `Ionicons "time-outline"` (blue clock), pending should use `Ionicons "ellipse-outline"` (empty circle).
- Must make Todo content area clickable to open sidebar with full rendered todo list. Currently TodoView is in `toolViewRegistry` but NOT in `toolFullViewRegistry` (no `TodoWrite` entry in `_all.tsx` line 52-58). Need to either: add a `TodoViewFull` or reuse `TodoView` in the sidebar.
- `SidebarContentRenderer` currently does NOT handle TodoWrite - it falls through to `SidebarGenericView`. Need to add TodoWrite to the sidebar routing.

### Should Have

- Sidebar navigation stack with back button for sub-tool drill-down (R3)
- Smooth animation when transitioning between sidebar views
- Proper i18n for any new labels (orchestrator prompt header, back button)

### Could Have

- Breadcrumb trail in sidebar header showing navigation depth
- Keyboard shortcuts for sidebar navigation (already has Escape to close)

### Won't Have (Non-Goals)

- Changing the detail page (`[messageId].tsx`) rendering for any tool
- Adding sidebar support for file tools (Edit/Write) - already exists
- Modifying the main chat message rendering order
- Mobile-specific sidebar navigation (modal already handles this)

## Edge Cases & Risks

- Agent tools with empty `tool.input.prompt` (description-only agents) - show description instead
- Deeply nested sub-agents (Agent within Agent) - sidebar stack could get deep; consider limiting depth or showing breadcrumbs
- TodoWrite tools with empty todos array - already handled by `minimal` check in knownTools
- Bash tools with very long first-line output - need to truncate abbreviated content
- `onContentPress` is only passed when the parent provides it; sidebar sub-tools currently don't have this callback, so clicking nested tool content in sidebar won't work without explicit wiring

## Acceptance Criteria

### AC1: Agent sidebar shows orchestrator prompt
- GIVEN an Agent/Task tool call with `tool.input.prompt` set
- WHEN the user opens the sidebar for this tool
- THEN the orchestrator prompt is displayed at the top of the sidebar, followed by all child messages

### AC2: Agent sidebar shows all message types
- GIVEN an Agent tool with agent-text, tool-call, and agent-event children
- WHEN the sidebar is open
- THEN all child message types are rendered (not just agent-text and tool-call)

### AC3: Sub-tool clicks stay in sidebar
- GIVEN the sidebar is showing an Agent conversation with child tool-calls
- WHEN the user clicks a child tool header
- THEN the sidebar content is replaced with the clicked tool's detail view
- AND a back button appears to return to the parent agent conversation
- AND the main content area does NOT navigate

### AC4: Bash inline shows abbreviated output
- GIVEN a completed Bash tool call with stdout output
- WHEN it renders in the main chat
- THEN the content area below the header shows the first 3-5 lines of terminal output
- AND clicking the content area opens the sidebar with full terminal rendering

### AC5: Todo content opens sidebar
- GIVEN a TodoWrite tool call with todos
- WHEN the user clicks the content area
- THEN the sidebar opens showing the full rendered todo list

### AC6: Todo checkbox icons match design
- GIVEN a TodoWrite tool with completed, in-progress, and pending items
- WHEN rendered (inline or sidebar)
- THEN completed items show green checkmark-circle icon with strikethrough text
- AND in-progress items show blue clock icon
- AND pending items show empty circle icon

## Technical Hints

- Affected files:
  - `components/sidebar/SidebarAgentConversation.tsx` - R2: add prompt display, handle all message kinds
  - `components/sidebar/SidebarContentRenderer.tsx` - R5: add TodoWrite routing
  - `components/sidebar/SidebarAgentConversation.tsx` - R3: pass custom onPress to child ToolViews
  - `stores/rightSidebarStore.ts` - R3: add navigation stack (history array + push/pop)
  - `components/RightSidebar.tsx` - R3: add back button, use stack from store
  - `components/tools/views/BashView.tsx` - R4: show abbreviated stdout/stderr
  - `components/tools/views/TodoView.tsx` - R5: replace text icons with Ionicons
  - New file: `components/sidebar/SidebarTodoView.tsx` - R5: sidebar todo renderer
- Data availability:
  - `tool.input.prompt` contains the orchestrator prompt for Agent/Task tools
  - `tool.input.description` is used for the title (separate from prompt)
  - `Message.children[]` contains all sub-messages including nested tool-calls with their own children
  - Bash `tool.result` is parsed via `knownTools.Bash.result` schema to get `stdout`/`stderr`
- Related patterns:
  - `SidebarBashView` already renders full terminal in sidebar - reuse for Bash sidebar
  - `ToolStatusIcon` in `TaskView.tsx` already has the green checkmark-circle pattern
  - `useRightSidebar` Zustand store manages sidebar open/close state
- Constraints:
  - Never use `router.push()` from within sidebar components - all navigation must stay sidebar-internal
  - Must work on both desktop (side panel) and mobile (modal) sidebar modes
  - Follow existing i18n pattern with `t()` for all new strings
