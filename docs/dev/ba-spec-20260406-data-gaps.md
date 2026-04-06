# BA Specification: Sidebar Data Display Gaps

**Request ID**: dev-20260406-data-gaps
**Created**: 2026-04-06T09:00:00Z

## Goal

Fix four data display issues in the sidebar agent conversation view: missing subagent content (TodoWrite + narration text), Edit full-file limitation, AskUserQuestion answer persistence, and Bash rendering inconsistency between inline and sidebar views.

## Context

The sidebar agent conversation (`SidebarAgentConversation.tsx`) renders child messages from subagent (Agent/Task) tool calls. Several content types are either dropped, inconsistently rendered, or lack persistence. These issues were identified during manual QA of the sidebar feature.

## Requirements (MoSCoW)

### Must Have

- **Issue A - Subagent data in sidebar**: The `ChildMessageBlock` switch/case in `SidebarAgentConversation.tsx` handles four `message.kind` values: `agent-text`, `tool-call`, `agent-event`, `user-text`. The `default` case returns `null`, which drops any unknown kind. However, analysis shows all expected message kinds ARE handled. The ACTUAL problem is:
  1. **TodoWrite IS rendered** -- it flows through `kind: 'tool-call'` -> `ChildToolBlock` -> `ToolView` -> `TodoView`. The `filterToLatestTodoWrite` function (line 137-152) correctly keeps only the latest TodoWrite, filtering earlier ones. This is correct behavior. If TodoWrite is not appearing, the root cause is upstream: the reducer may not be placing TodoWrite messages into `message.children[]` for agent tool calls, OR the TodoWrite tool calls from subagents are not being captured as children of the Agent tool call.
  2. **Agent narration text IS handled** -- `agent-text` with `isThinking: false` renders through MarkdownView (lines 101-112). If narration text is missing, the root cause is upstream: the text messages may not be present in `message.children[]` as delivered from the reducer.
  
  **Root cause**: Verify that the reducer correctly populates `children[]` for Agent/Task tool-call messages with ALL child messages including TodoWrite tool calls and non-thinking agent-text. The rendering layer handles all types correctly.

### Should Have

- **Issue D - Bash rendering consistency**: Inline `BashView` (used in both main chat and sidebar) truncates output to 3 lines and caps at `maxHeight: 80`. The full view `BashViewFull` shows complete output with horizontal scrolling. In the sidebar, Bash renders via `ChildToolBlock` -> `ToolView` -> `BashView` (the inline variant), so it uses the same truncated 3-line preview. This is CONSISTENT -- both main chat inline and sidebar inline use the same `BashView` component. The perceived inconsistency may come from the sidebar having less horizontal space, making the preview feel more cramped. No code change needed unless the user wants sidebar bash to use `BashViewFull` instead.

### Could Have

- **Issue C - AskUserQuestion answer persistence**: The answer flow works as follows:
  1. User selects options in `AskUserQuestionView`
  2. `handleSubmit` calls `sessionAllow(sessionId, permissionId, ..., responseText, answersRecord)`
  3. CLI `permissionHandler.ts` receives `answers` in the permission response (line 123-136)
  4. CLI resolves with `updatedInput: { ...baseInput, answers }` -- answers are merged into the tool INPUT
  5. Claude SDK receives the answers as updated tool input and processes them
  6. The tool RESULT from Claude does not include the answers -- it contains Claude's response to the answers
  7. On component remount, `AskUserQuestionView` (line 269-302) tries to recover answers from `tool.result.answers` or `tool.permission.answers`
  
  **Root cause**: The answers are sent via `updatedInput` to the Claude SDK, but neither the tool result nor the permission object persists them back to the app. The `tool.permission` object in the app only has `id`, `status`, `reason`, `mode`, `allowedTools`, `decision`, `date` -- no `answers` field.
  
  **Fix options**:
  a. CLI-side: After receiving `updatedInput` with answers, include the answers in the tool result or persist them in the permission response sent back to the app
  b. App-side: Store answered state in MMKV keyed by permission ID, so it survives remounts
  c. Server-side: Add answers to the permission response broadcast

### Won't Have (Non-Goals)

- **Issue B - Edit full file display**: The `Edit` tool's `tool.input` contains only `file_path`, `old_string`, `new_string`, and `replace_all`. No full file content is available in the data. The sidebar already renders the diff (old -> new) via `EditView`/`SidebarFileView`. Showing the complete file content would require the CLI to include the full file content in the tool result, which is not currently done and would significantly increase message payload sizes. This is a DATA LIMITATION, not a rendering bug. Document and defer.
- Changing Bash rendering behavior in sidebar (uses same component as main chat -- this is by design)

## Edge Cases & Risks

- `filterToLatestTodoWrite` correctly handles multiple TodoWrite calls by keeping only the last one -- this is intentional UX, not a bug
- `ChildMessageBlock` `default: return null` drops unknown message kinds silently -- this is defensive but could hide new message types added in the future
- AskUserQuestion answer recovery relies on local React state (`selections`) which is lost on unmount; the fallback paths (`tool.result.answers`, `tool.permission.answers`) are currently never populated

## Acceptance Criteria

### AC1: Subagent TodoWrite visible in sidebar
- GIVEN a session where a subagent (Agent tool) calls TodoWrite
- WHEN the user opens the sidebar for that Agent tool call
- THEN the latest TodoWrite snapshot is rendered in the conversation view

### AC2: Subagent narration text visible in sidebar
- GIVEN a session where a subagent produces non-thinking agent-text
- WHEN the user opens the sidebar for that Agent tool call
- THEN the narration text is rendered with sparkles icon and MarkdownView

### AC3: AskUserQuestion answers persist across remounts
- GIVEN a completed AskUserQuestion tool call where the user selected answers
- WHEN the component remounts (e.g., navigating away and back)
- THEN the previously selected answers are still displayed

### AC4: Bash rendering consistency documented
- GIVEN bash tool calls in both main chat and sidebar
- WHEN rendered in both locations
- THEN both use the same BashView component with identical truncation behavior

## Technical Hints

- Affected files for Issue A (upstream investigation needed):
  - `sources/sync/reducer.ts` -- how children[] is populated for Agent/Task tool calls
  - `sources/sync/typesRaw.ts` -- raw message normalization
  - `sources/components/sidebar/SidebarAgentConversation.tsx` -- rendering layer (CONFIRMED CORRECT)
- Affected files for Issue C:
  - `packages/happy-cli/src/claude/utils/permissionHandler.ts:123-136` -- answers flow
  - `sources/components/tools/views/AskUserQuestionView.tsx:269-302` -- answer recovery
  - `sources/sync/ops.ts:326` -- sessionAllow sends answers
  - `sources/sync/typesMessage.ts:14-22` -- ToolCall.permission type (missing `answers` field)
- Related patterns: Permission handling uses RPC via WebSocket, answers are ephemeral in the current flow
- Constraints: Edit tool does not expose full file content in tool.input or tool.result
