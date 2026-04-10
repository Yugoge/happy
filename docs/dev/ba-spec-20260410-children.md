# BA Specification: Agent/Task Tool Detail View Missing Children

**Request ID**: dev-20260410-children
**Created**: 2026-04-10

## Goal

Fix the Agent/Task tool detail view so it renders sidechain children (the subagent conversation) instead of only showing generic Description/Input/Output sections.

## Context

When clicking an Agent or Task tool call in the session message list, the detail view (desktop InlineDetailView or mobile message detail page) renders via `ToolFullView`. This component checks `toolFullViewRegistry` for a specialized full-view component. The registry has entries for `MultiEdit` but NOT for `Task` or `Agent`, causing the detail view to fall through to the generic layout (Description, Input Parameters, Output, Error). The `TaskViewFull` component exists and is imported in `_all.tsx` but was never registered.

Meanwhile, the inline `TaskView` (compact view in the message list) correctly receives and displays children via the regular `toolViewRegistry`, which DOES map Task/Agent to `TaskView`. This confirms that the sidechain data pipeline (CLI mapper -> server -> app normalizer -> tracer -> reducer -> children) works correctly. The bug is purely in the detail view registry.

## Requirements (MoSCoW)

### Must Have
- Register `Task` and `Agent` in `toolFullViewRegistry` mapping to `TaskViewFull`
- Verify children render in the detail view for both Task and Agent tool calls

### Should Have
- Confirm sidebar path (mobile SidebarAgentConversation) also works correctly (it uses a different code path via SidebarContentRenderer, not toolFullViewRegistry)

### Could Have
- N/A

### Won't Have (Non-Goals)
- Changes to the sidechain data pipeline (it works correctly)
- Changes to the CLI session protocol mapper
- Changes to the reducer or tracer logic
- Changes to TaskViewFull component itself

## Edge Cases & Risks

- TaskViewFull renders `message.children` which comes from `convertReducerMessageToMessage` -> `state.sidechains.get(reducerMsg.realID)`. If realID is null (permission-only messages without a matching tool call), children will be empty. This is expected behavior.
- Out-of-order sidechain messages with CUID2 parentUUID may not be buffered as orphans (isUuidLike check at reducerTracer.ts:284 rejects non-UUID formats). However, in practice, tool-call-start always arrives before sidechain children due to sequential processing in the CLI mapper. This is a latent issue, not the current bug.

## Acceptance Criteria

### AC1: Task/Agent detail view shows children
- GIVEN a session with an Agent or Task tool call that has sidechain children
- WHEN the user clicks the tool call header to open the detail view
- THEN the detail view renders `TaskViewFull` showing the expandable sub-tools section with the children conversation

### AC2: Registry is complete
- GIVEN the `toolFullViewRegistry` in `_all.tsx`
- WHEN inspecting its entries
- THEN both `Task` and `Agent` map to `TaskViewFull`

## Technical Hints

- Affected file: `packages/happy-app/sources/components/tools/views/_all.tsx` lines 52-54
- Fix: Add `Task: TaskViewFull` and `Agent: TaskViewFull` to `toolFullViewRegistry`
- Related patterns: `toolViewRegistry` already maps Task/Agent to `TaskView` (lines 44-45)
- Constraints: `TaskViewFull` is already imported (line 11) and exported (line 78)
