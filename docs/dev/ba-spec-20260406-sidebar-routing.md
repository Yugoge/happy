# BA Specification: Tool Click Routing -- Dual Click Targets for Sidebar

**Request ID**: dev-20260406-sidebar-routing
**Created**: 2026-04-06T09:00:00Z

## Goal

Split ToolView click handling into two distinct click zones: clicking the **header** navigates to the existing detail page (`/session/[id]/message/[messageId]`), while clicking the **content body** opens a new right sidebar with rich content. For tools without specialized content views, keep the current single-click-on-whole-card behavior.

## Context

Currently, `ToolView.tsx` wraps the entire header in a single `TouchableOpacity` that calls `handlePress`, which either invokes a custom `onPress` callback or navigates via `router.push()` to the message detail page. The content area below the header has no click handler. The requirement is to make the content area clickable as a separate target that opens a right sidebar (built by another group), while preserving the existing header click behavior.

The tool view registry (`_all.tsx`) defines which tools have specialized inline content views. Tools in `toolViewRegistry` (Edit, Bash, Write, TodoWrite, Task/Agent, CodexBash, CodexPatch, CodexDiff, AskUserQuestion, etc.) render a `SpecificToolView` in the content area. Tools NOT in this registry render generic input/output JSON or error blocks. The dual-click-zone behavior should only apply to tools that have a `SpecificToolView` -- those are the ones with rich content worth showing in a sidebar.

For Task/Agent tools, the inline `TaskView` shows a status row with sub-tool items. These items should become individually clickable to open the sidebar showing the sub-agent's conversation.

## Requirements (MoSCoW)

### Must Have
- Split `ToolView` into two click zones: header (TouchableOpacity -> detail page) and content body (TouchableOpacity -> sidebar callback)
- Content click zone only active when tool has a registered `SpecificToolView` in `toolViewRegistry`
- For tools WITHOUT a registered view: keep current behavior (header click -> detail page, no content click)
- Accept a new `onContentPress` callback prop on `ToolView` (or equivalent) for sidebar integration
- TaskView status row items become individually pressable, each triggering sidebar with sub-tool data
- Pass sufficient data to sidebar callback: `tool`, `messages`, `metadata`, `sessionId`

### Should Have
- Visual feedback on content area press (activeOpacity or subtle highlight)
- Content area should NOT be pressable when tool is in `running` state with no content yet
- TaskView items should show a hover/press indicator on web

### Could Have
- Different cursor style on web for header (pointer) vs content (pointer with different visual)
- Accessibility labels distinguishing the two click zones

### Won't Have (Non-Goals)
- Building the actual right sidebar component (separate group's responsibility)
- Changing the detail page (`[messageId].tsx`) behavior
- Modifying the `ToolFullView` component
- Adding new tool view registry entries

## Edge Cases & Risks

- **Minimal tools**: When `cfg.minimal` is true, no content area renders (line 85-94 in ToolView.tsx). The dual-click split is irrelevant -- header-only click is correct.
- **Error-only content**: Some tools render only `ToolError` without a SpecificToolView. These should NOT get a content click zone since there is no rich content for the sidebar.
- **PermissionFooter**: The permission footer at the bottom of the tool card (lines 96-104) should NOT be part of the content click zone. It has its own interactive buttons.
- **Nested ToolView in TaskViewFull**: `TaskViewFull` renders child `ToolView` components recursively (line 84). These nested instances also receive `sessionId`/`messageId` and should support the same dual-click behavior.
- **onPress override**: When `ToolView` receives a custom `onPress` prop (used in some contexts), the content click should still work independently -- `onPress` only overrides the header behavior.

## Acceptance Criteria

### AC1: Header click navigates to detail page
- GIVEN a tool card with a registered SpecificToolView
- WHEN user clicks the header row (icon + title area)
- THEN the app navigates to `/session/[id]/message/[messageId]`

### AC2: Content click triggers sidebar callback
- GIVEN a tool card with a registered SpecificToolView and an `onContentPress` callback provided
- WHEN user clicks anywhere in the content body below the header
- THEN the `onContentPress` callback is invoked with `{ tool, messages, metadata, sessionId }`

### AC3: No content click for unregistered tools
- GIVEN a tool card WITHOUT a registered SpecificToolView (e.g., Read, Glob, WebSearch)
- WHEN user clicks anywhere on the card
- THEN only the header click behavior applies (navigate to detail page)

### AC4: Minimal tools unchanged
- GIVEN a tool card where `cfg.minimal` is true (no content rendered)
- WHEN user clicks the header
- THEN it navigates to the detail page (unchanged behavior)

### AC5: TaskView sub-tool items trigger sidebar
- GIVEN a Task/Agent tool card with sub-tool items in the status row
- WHEN user clicks on a specific sub-tool item
- THEN the sidebar opens showing that sub-tool's data and conversation

### AC6: PermissionFooter not affected
- GIVEN a tool card with a PermissionFooter
- WHEN user clicks the permission approve/deny buttons
- THEN the permission action fires normally (not intercepted by content click)

## Technical Hints

- Affected files:
  - `packages/happy-app/sources/components/tools/ToolView.tsx` -- Add `onContentPress` prop, wrap content in conditional TouchableOpacity
  - `packages/happy-app/sources/components/tools/views/TaskView.tsx` -- Make status row items pressable with `onSubToolPress` callback
  - `packages/happy-app/sources/components/MessageView.tsx` -- Pass `onContentPress` from session view context down through ToolCallBlock
- Key decision: The content `TouchableOpacity` wraps only the `ToolContent` area (lines 86-93), NOT the `PermissionFooter`.
- The `getToolViewComponent(tool.name)` function (line 233) already tells us whether a tool has rich content. Use this as the gate for enabling content click.
- For TaskView, each `toolItem` View (line 78) becomes a `TouchableOpacity` with an `onPress` that calls the sidebar callback with the specific sub-tool's data.
- The sidebar callback signature should be: `(data: { tool: ToolCall; messages: Message[]; metadata: Metadata | null; sessionId: string }) => void`
