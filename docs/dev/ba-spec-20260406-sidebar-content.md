# BA Specification: Right Sidebar Content Renderers

**Request ID**: dev-20260406-sidebar-content
**Created**: 2026-04-06

## Goal

Create four specialized sidebar content renderers that display tool content in the right sidebar when a user clicks on a tool call in the main conversation. Each renderer type matches a tool category: Agent/Task sub-conversations, file modifications (Edit/Write/MultiEdit), terminal/Bash output, and a generic fallback for other tools.

## Context

The happy-app already has a rich rendering pipeline for tool calls. The main conversation uses `MessageView` -> `ToolView` for inline (compact) views, and `ToolFullView` for expanded detail views (navigated via `router.push(/session/{id}/message/{messageId})`). The right sidebar (being built by GROUP A/B) needs content renderers that reuse these existing components rather than duplicating rendering logic.

Key existing components:
- `ToolFullView` renders expanded tool details in a ScrollView with description, input, specialized view, output, error sections
- `TaskViewFull` renders Agent/Task sub-conversations using `ChildMessageBlock` which dispatches to `MarkdownView` (for agent-text) and `ToolView` (for nested tool-calls) -- same recursive rendering as the main chat
- `BashViewFull` renders terminal output using `CommandView` with horizontal scroll
- `EditViewFull` renders file diffs using `ToolDiffView` -> `DiffView` -> `calculateUnifiedDiff`
- `MultiEditViewFull` renders multiple edit hunks with `DiffView` directly
- The `_all.tsx` registry maps tool names to both inline (`toolViewRegistry`) and full (`toolFullViewRegistry`) view components

The sidebar renderers are essentially "full views" adapted to render inside a sidebar panel instead of a dedicated screen. The primary challenge is: the existing full views navigate via expo-router push (to `/session/{id}/message/{messageId}`), but the sidebar should display content inline without navigation.

## Requirements (MoSCoW)

### Must Have
- `SidebarAgentConversation`: renders Agent/Task sub-conversations in the sidebar, reusing the same `ChildMessageBlock` pattern from `TaskViewFull` (MarkdownView for text, ToolView for nested tools) -- but always expanded (no toggle)
- `SidebarFileView`: renders Edit/Write/MultiEdit content with full diff highlighting via `ToolDiffView`/`DiffView`, file path shown as header, scrollable content
- `SidebarBashView`: renders Bash/CodexBash terminal output with command at top and stdout/stderr below, using `CommandView`
- `SidebarGenericView`: fallback renderer that shows `ToolFullView` content for any other tool type
- A dispatcher component (`SidebarContentRenderer`) that selects the appropriate renderer based on tool name
- All renderers accept a consistent props interface: `{ tool: ToolCall, metadata: Metadata | null, messages: Message[], sessionId: string }`
- Nested tool clicks within sidebar Agent conversation should update the sidebar content (not navigate)

### Should Have
- File path header for Edit/Write/MultiEdit showing the resolved relative path (using `resolvePath` from `pathUtils`)
- Syntax-highlighted line numbers and +/- symbols in diff views (always on, matching `EditViewFull` behavior)
- For Write tool: show all-green diff (oldText='', newText=content) matching existing `WriteView` pattern
- For MultiEdit: show all edits sequentially with edit numbers, matching `MultiEditViewFull` pattern

### Could Have
- Full file content display (not just the changed portion) for Edit operations -- requires fetching file content from Read tool results in the same session
- Click-to-navigate within nested Agent conversations (click a nested tool to show it in sidebar)
- Copy button for terminal command output

### Won't Have (Non-Goals)
- Inline editing of files from the sidebar
- Running commands from the sidebar
- Creating new sidebar renderer types beyond the four specified
- Mobile-specific sidebar layout (sidebar is desktop/tablet only)

## Edge Cases & Risks

- Agent/Task tools can be deeply nested (Agent -> Agent -> Agent). The recursive rendering must handle arbitrary depth without stack overflow or UI breakage.
- Some tools have no result yet (state='running'). Renderers must show loading/in-progress state gracefully.
- Edit tool only provides `old_string` and `new_string` (the changed portion), not the full file. The "full file content" requirement for Could Have needs a separate data source.
- The `messages` array on ToolCallMessage.children contains the sub-agent conversation. For Agent/Task tools this is the primary content. For Bash/Edit it is empty.
- CodexBash and CodexPatch use different input schemas than Bash and Edit. The dispatcher must handle both.
- Write tool has no old_string, only content -- should render as all-additions diff.

## Acceptance Criteria

### AC1: Agent/Task sidebar rendering
- GIVEN a user clicks on an Agent/Task tool call in the main conversation
- WHEN the sidebar opens with SidebarAgentConversation
- THEN the full sub-agent conversation is visible with text blocks (MarkdownView) and nested tool calls (ToolView), all expanded without requiring a toggle

### AC2: Edit/Write sidebar rendering
- GIVEN a user clicks on an Edit tool call
- WHEN the sidebar opens with SidebarFileView
- THEN the file path is shown as a header, and a unified diff is displayed with line numbers and +/- symbols showing old_string removed (red) and new_string added (green)

### AC3: Bash sidebar rendering
- GIVEN a user clicks on a Bash tool call that has completed
- WHEN the sidebar opens with SidebarBashView
- THEN the command is shown at the top, stdout is displayed below, and stderr (if any) is shown separately

### AC4: Generic tool sidebar rendering
- GIVEN a user clicks on a tool not covered by specific renderers (e.g., WebSearch, Glob)
- WHEN the sidebar opens with SidebarGenericView
- THEN the tool's input and output are displayed in the same format as ToolFullView

### AC5: Dispatcher routing
- GIVEN any tool click that triggers the sidebar
- WHEN SidebarContentRenderer receives the tool data
- THEN it routes to the correct renderer: Agent/Task -> SidebarAgentConversation, Edit/Write/MultiEdit -> SidebarFileView, Bash/CodexBash -> SidebarBashView, everything else -> SidebarGenericView

## Technical Hints

- Affected files:
  - NEW: `sources/components/sidebar/SidebarContentRenderer.tsx` (dispatcher)
  - NEW: `sources/components/sidebar/SidebarAgentConversation.tsx`
  - NEW: `sources/components/sidebar/SidebarFileView.tsx`
  - NEW: `sources/components/sidebar/SidebarBashView.tsx`
  - NEW: `sources/components/sidebar/SidebarGenericView.tsx`
- Reuse patterns from:
  - `TaskViewFull.tsx` lines 16-31 (ChildMessageList + ChildMessageBlock) for Agent conversation
  - `EditViewFull.tsx` (ToolDiffView usage) for Edit diffs
  - `BashViewFull.tsx` (CommandView with ScrollView) for terminal output
  - `ToolFullView.tsx` (full layout pattern) for generic fallback
  - `WriteView.tsx` (oldText='', newText=content pattern) for Write files
  - `MultiEditViewFull.tsx` (multiple DiffView hunks) for MultiEdit
- The tool name to renderer mapping: `{ Task: Agent, Agent: Agent, Bash: Bash, CodexBash: Bash, Edit: File, Write: File, MultiEdit: File, CodexPatch: File, * : Generic }`
- Props interface should match `ToolViewProps` from `_all.tsx`: `{ tool: ToolCall, metadata: Metadata | null, messages: Message[], sessionId?: string }`
- Use `knownTools` Zod schemas for input parsing (same as existing views)
- Use `resolvePath` from `@/utils/pathUtils` for file path display
- Styles: use `StyleSheet.create` from `react-native-unistyles` with theme access
