<!-- AUTO-GENERATED VIEW for dev | source: docs/dev/specs/spec-20260424-084848.md | extracted: 2026-04-24T08:48:48Z -->

# dev view of spec-20260424-084848

**Monolith**: docs/dev/specs/spec-20260424-084848.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate (from spec)

> WHO WRITES: Dev (after each implementation attempt)

> WHAT: Per-cycle record of what approach was tried, what the rationale was, and why it failed (if it failed).

> This prevents the next cycle's Dev from repeating the same approach.

> WHO WRITES: Dev (after each implementation)

> WHAT: Exact file changes with line numbers and old->new values.

> FORMAT: - **file.tsx:42** -- `property: oldValue` -> `property: newValue`

---

# Spec: Per-session model persistence + model indicator in status bar

**Pipeline**: standalone
**Session**: manual
**Created**: 2026-04-24T08:48:48+00:00

---

#### Background exploration (happy-app React Native)

**Model selection UI**
- `packages/happy-app/sources/components/AgentInput.tsx` lines 600-764 — settings overlay; model radio rendered at lines 694-752 via `props.onModelModeChange?.(model)`.
- Options source: `packages/happy-app/sources/components/modelModeOptions.ts` — `getHardcodedModelModes()` (lines 124-135), `getDefaultModelKey(flavor)` (lines 189-197).
- Current-value resolution (SessionView.tsx line 204): `resolveCurrentOption(models, [session.modelMode, session.metadata?.currentModelCode, getDefaultModelKey(flavor)])`.

**Permission-mode selection (reference pattern — already persisted per session)**
- `packages/happy-app/sources/components/AgentInput.tsx` lines 613-673 — overlay rendering.
- `packages/happy-app/sources/sync/storage.ts`:
  - `updateSessionPermissionMode()` lines 834-862 — updates in-memory state AND calls `saveSessionPermissionModes(allModes)` (line 856).
  - Resolution on session load (lines 320-339) — priority: existing in-memory → MMKV saved → server metadata → sandbox-aware default.
- `packages/happy-app/sources/sync/persistence.ts` lines 191-206 — MMKV key `'session-permission-modes'`, stored as `Record<sessionId, modeKey>` JSON. Loaded at storage init (line 259).

**Status bar / footer row**
- `packages/happy-app/sources/components/AgentInput.tsx` lines 770-904 — footer renderer.
  - Left (lines 781-875): `connectionStatus` text + context warning (`● online • 69% left`).
  - Right (lines 877-902): permission-mode badge — icon (`play-forward` / `pause`) + colored name (the `yolo` chip).
- Hook for the new model chip: insert a parallel `View` immediately BEFORE the permission badge `View` (i.e., to the left of `yolo`) inside the right-side container. Style/pattern can mirror lines 877-902.

**Session metadata**
- `packages/happy-app/sources/sync/storageTypes.ts`:
  - `Session` (lines 77-111) has LOCAL fields `permissionMode?: string | null` and `modelMode?: string | null`; also `metadata.currentModelCode`, `metadata.currentOperatingModeCode` (server-synced, lines 7-52).

**Current re-entry behaviour — the root cause**
- `packages/happy-app/sources/sync/storage.ts`:
  - `updateSessionModelMode()` lines 864-882 — **updates Zustand state only, NO MMKV write**. Asymmetric with the permission-mode path.
  - On session load there is **no MMKV-sourced model override** in the `modelMode` resolution (unlike permission-mode which has one at lines 320-339).
- Net: leaving and re-entering a session re-resolves `modelMode` from `session.metadata?.currentModelCode` (server) or `getDefaultModelKey(flavor)` (fallback), so any local GUI pick is lost.

The fix shape is a mirror of the permission-mode plumbing: new MMKV key (e.g. `session-model-modes`), persist inside `updateSessionModelMode()`, load at storage init, feed into the same `modelMode` resolution step in `storage.ts`, and extend the right-side status-bar cluster with a model chip placed immediately left of the permission badge.

#### Background exploration — requirement §5.2 (1M-context context-% bug)

**Root cause found (single-line hardcode)**
- `packages/happy-app/sources/components/AgentInput.tsx` line 85:
  ```ts
  const MAX_CONTEXT_SIZE = 190000;
  ```
  This constant is the denominator of the status-bar percentage for EVERY model. There is no per-model context-window table anywhere in the repo (verified absence in `modelModeOptions.ts`, `packages/happy-cli/src/utils/pricing.ts`, `packages/happy-wire/src/`, `packages/happy-app/sources/sync/`).

**Percentage computation**
- `packages/happy-app/sources/components/AgentInput.tsx` lines 292-305 (`getContextWarning`):
  ```ts
  const percentageUsed = (contextSize / MAX_CONTEXT_SIZE) * 100;
  const percentageRemaining = Math.max(0, Math.min(100, 100 - percentageUsed));
  ```
- Rendered at line 873 as `{contextWarning.text}` inside the footer.

**Degenerate path for 1M models**
- For a 1M-context session where `contextSize` exceeds `190000` (e.g. 500k tokens), `percentageUsed > 100`, `percentageRemaining` clamps to `0`, so the UI shows `0% left`. This matches the user's report.

**Token-usage input is sound**
- `packages/happy-app/sources/sync/reducer/reducer.ts` line 1233:
  ```ts
  contextSize: (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) + usage.input_tokens
  ```
- Stored on `session.latestUsage.contextSize` (`storageTypes.ts` 103-110), passed as `props.usageData?.contextSize` (SessionView.tsx:500).
- Numerator is correct; denominator is wrong for 1M models.

**Model identifier is available at the call site but unused**
- `AgentInput` already receives `props.modelMode`, and `session.metadata?.currentModelCode` is in scope (SessionView.tsx:204).
- `getContextWarning()` currently only takes `(contextSize: number, alwaysShow: boolean, theme: Theme)` — no model argument. The fix requires threading the model identifier into this function (or, equivalently, computing `maxContextSize` at the call site from the resolved model and passing it in).

**Fix shape for §5.2**
1. Introduce a per-model context-window lookup (e.g. `getModelContextWindow(modelKey)` co-located with `modelModeOptions.ts`). Default 200k for current Claude models, 1,000,000 for any key carrying the `[1m]` suffix / 1M family.
2. Replace the `MAX_CONTEXT_SIZE = 190000` hardcode with a resolved per-session maximum driven by `session.modelMode ?? session.metadata?.currentModelCode`.
3. Preserve the existing warning thresholds (≤5% critical, ≤10% warning) — they are percentage-based and remain correct once the denominator is right.
4. Coverage must span every 1M Claude variant surfaced by the model picker (matches the user's "全部1M系列模型" scope).

#### Background exploration — requirements §5.3–§5.7

**§5.3 — Bash popup overflow**
- `packages/happy-app/sources/components/tools/views/BashView.tsx` lines 61-82: inline BashView uses `ScrollView horizontal showsHorizontalScrollIndicator={true}` (line 62).
- `packages/happy-app/sources/components/sidebar/SidebarBashView.tsx` lines 43-59: right-side popup wraps a horizontal `ScrollView` (lines 44-46) and delegates to `CommandView`.
- `packages/happy-app/sources/components/CommandView.tsx` lines 33-90: container `padding: 16, alignItems: 'flex-start'`; line `flexDirection: 'row', flexWrap: 'wrap'`; command `flex: 1`; no `overflow: 'hidden'` / `whiteSpace: 'nowrap'` / hard width caps.
- **Discrepancy with user report**: horizontal scroll IS declared on the ScrollView in both code paths, yet the screenshot clearly shows the command text exceeding the popup. Likely causes to validate at dev time: (a) the inner row uses `flexWrap: 'wrap'` which forces wrap-and-overflow rather than scroll when the child `flex: 1` command takes maximum width, (b) the ScrollView's parent (popup container) has no effective max-width constraint on web / narrow desktop, or (c) a `$ ` prefix view plus the wrapping row breaks the horizontal-scroll intent. Dev must reproduce in the actual popup width and decide whether to remove `flexWrap`, tighten the container's `maxWidth` / `overflow`, or constrain the child `flex: 1` so the ScrollView actually owns scrolling.

**§5.4 + §5.5 — "Hardcoded" top-bar**
- `packages/happy-app/sources/components/navigation/Header.tsx` lines 210-235: top bar uses flex row (`leftContainer` flexGrow 0, `centerContainer` flexGrow 1 flexBasis 0, `rightContainer` flexGrow 0). `maxWidth: layout.headerMaxWidth` is applied to `content`.
- `packages/happy-app/sources/components/HeaderLogo.tsx` lines 14-26: logo is a 32×32 flex container, not absolutely positioned.
- `packages/happy-app/sources/components/SidebarNavigator.tsx` lines 21-24: left drawer width is responsive — `min(max(floor(windowWidth*0.3), 250), 360)`.
- `packages/happy-app/sources/components/RightSidebar.tsx` line 11 + 132-144: right sidebar width is **fixed at `SIDEBAR_WIDTH = 450px`**.
- `packages/happy-app/sources/components/MainView.tsx` lines 29-99: `sidebarContentContainer` is flex-1 flexBasis-0, but has no awareness of the right sidebar's open/close state.
- **Reconciling the user's "位置 hardcoded" claim**: strictly speaking the logo/avatar themselves are NOT positioned with `position: absolute` or pixel offsets; they sit in flex containers. The real hardcoding lives elsewhere in the same region: `layout.headerMaxWidth` is a static 800–1400px clamp that does NOT track main-column width changes, and `RightSidebar` is a fixed 450px panel that the header does not reflow around. The user-visible bug ("logo + avatar don't follow content stretching") is a downstream effect of the header's static `maxWidth` + the fixed right sidebar width, not of absolute positioning on the logo/avatar. Dev fix should make the header's `maxWidth` (or centerContainer width) a function of: window width − left drawer width − right sidebar width (when open).
- **Targeted question for the user** (non-blocking — ask inline on finalize if unresolved): "In §5.4/§5.5, is the fix target A) the happy logo and avatar elements themselves (re-position them), or B) the header width / right-sidebar reserved width (so the whole row reflows and the logo/avatar follow)?" Default assumption if unanswered: **(B)** based on the exploration finding.

**§5.6 — Codex popup vs Claude Code popup**
- `packages/happy-app/sources/components/tools/views/CodexBashView.tsx` lines 18-102: structurally different from `BashView`. Reads `input.parsed_cmd`; branches on operation type `'read' | 'write' | 'bash' | 'unknown'` (lines 27-35). Read/write branches render an icon + operation text (lines 52-85); bash branch falls through to `CommandView` (lines 86-101).
- Container differs: `padding: 12, backgroundColor: theme.colors.surfaceHigh, borderRadius: 8` (lines 104-126).
- Horizontal scroll is NOT enabled in the read/write branches.
- Claude-Code-side counterpart is `BashView.tsx` (above) — Codex never adopted that ScrollView + CommandView pattern uniformly.
- Fix shape: unify Codex's render path through `BashView` / `CommandView` (or a shared sub-component) so the redesign and its horizontal-scroll / overflow handling apply to both flavors.

**§5.7 — Codex `Description` is the raw command**
- `packages/happy-app/sources/components/tools/views/CodexBashView.tsx` — the "description" is **derived** from `parsed_cmd` type via i18n keys (e.g. `t('tools.desc.readingFile', { file: resolvedPath })`, line 61; similar at line 78), NOT from a dedicated description field.
- In screenshot §5.7 the popup's `Description` and `Input Parameters.description` both display the raw `/bin/bash -lc "…"` string, which is the fallback path when `parsed_cmd` is `unknown` or missing — in that case both sections appear to read the same command source.
- Fix shape: (i) separate "description" from "command" in the rendering contract (they must never share a source); (ii) when a real description is not available from the model, the `Description` block should either hide, or show a short generated summary (e.g. `Running bash`), rather than echoing the full command.

#### Background exploration — requirements §5.8–§5.18

**§5.8 — Markdown tables overflow width (port happy prod fix)**
- 3. Dev step: locate the production treatment (likely a horizontally-scrollable wrapper around the `<table>` / `MarkdownView` renderer) and replicate it in happy-dev for the same renderer.
- 9. Scope: applies wherever `MarkdownView` is used (conversation, detail panel, feedback docs, tool-call result previews).
- `packages/happy-app/sources/components/markdown/MarkdownView.tsx` is the shared renderer entry. Dev must inspect happy prod's corresponding file for the horizontally-scrollable table wrapper and port it. Do not re-invent.

**§5.9 — Stop-hook feedback visibility**
- 1. The current UI renders "Stop hook feedback" blocks (e.g., `SPEC COVERAGE ENFORCEMENT: spec-verify.py reports < 100% coverage. …`) directly in the user-facing conversation.
- 2. Expected: stop-hook output belongs in developer logs / internal telemetry only. It must not appear in the user's conversation view at all.
- 3. Scope: all stop-hook feedback variants, regardless of severity marker (✅, ❌, ⚠️) or whether the hook is a Python script, shell script, or other.
- Dev must find where stop-hook feedback is injected into the conversation message stream and suppress it from user-surface rendering while preserving the logged / telemetry pathway.

**§5.10 — Reconnect message ordering after long background-task disconnect**
- 2. **Root cause area**: happy's delivery queue / event re-ordering after reconnect. Claude's own ordering is correct — the bug lives in happy's transport/relay layer.
- 3. **Success conditions**:
   - The reconnect must not require user action — happy should reconnect proactively while the background task runs, so no queue divergence accumulates.
   - Whatever the reconnect trigger, messages forwarded to the user MUST arrive in causal order: every assistant reply is paired with the user message that caused it (or clearly labelled as background output, if it must be shown at all).
- Transport/relay layer lives in `packages/happy-cli/src/api/apiSession.ts` (CLI-side session WebSocket client) and server-side `presence/timeout.ts` (offline detection). Dev must inspect the reconnect/resume path for message-queue reordering on reconnect.

**§5.11 — Detail-panel long-path overflow**
- 1. The detail / tool-call panel's header displays the full `file_path` verbatim. When the path is long (e.g., `…applio/.claude/worktrees/overnight-20260423-c593e035/docs/dev/overnight/c593e035-9739-48c7-b87f-9c1700252083/user-fe…`), it overflows the detail-panel's horizontal bounds.
- 2. Expected: keep the full path accessible (tooltip / copy / tap-to-expand are all acceptable) but visually constrain it — truncate with ellipsis in the middle, wrap, or enable horizontal scroll inside a bounded container.
- 3. Visual success condition: zero horizontal overflow of the detail-panel header at any viewport width.
- `packages/happy-app/sources/components/RightSidebar.tsx` line 11 + 132-144: right sidebar width is **fixed at `SIDEBAR_WIDTH = 450px`**.
- The detail-panel header component renders inside `RightSidebar`. Dev should constrain the header's path display (ellipsis / scroll / wrap) so it respects the 450px fixed panel width.

**§5.12 — Attachment tray + oversize upload failure**
- 1. **Layout inconsistency**: in the message composer's attachment tray (above the text input), the top width of file/image thumbnails and the left/right margin width are still not uniform across attachment types. Expected: a single shared layout primitive — same padding, same gutter, same thumbnail box — whether the attachment is a file or an image.
- 2. **Silent oversize-upload failure**: when the user attaches a file that exceeds the upload size limit, the upload fails but **no error is shown**. The file appears selected in the tray; the message seems to send; nothing surfaces to indicate the upload did not complete.
- 3. Expected for (2): when upload fails for ANY reason (size, network, MIME), show a visible, user-readable error (inline in the composer, toast, badge on the failed thumbnail — any of these is acceptable) explaining the failure and the corrective action (e.g., "File exceeds NN MB limit").
- Dev scope: message-composer attachment-tray layout primitive + upload error surface. Unify file/image thumbnail box + margin into a single layout primitive; wire upload failures (size / network / MIME) to a visible error surface.

**§5.13 — Codex subagent tasks not displayed**
- 1. In the Codex flavor, subagent tasks (equivalent of Claude Code's `Agent` / Task tool calls that spawn a sub-agent) do not appear in the UI at all — the user cannot see that a subagent is running, its status, or its result.
- 2. Expected: Codex subagent tasks must render with the same visibility treatment as Claude Code's subagent tasks (header showing subagent name/description, status indicator, result block on completion).
- 3. Scope: applies both to the in-conversation inline card AND the right-side detail panel.
- 6. Alignment with §5.13: `functions.spawn_agent` / `wait_agent` / `resume_agent` / `close_agent` rendering is what resolves the "Codex subagent tasks not displayed" complaint — implementing §5.15 row-by-row should make §5.13 fall out naturally.
- Dev must extend the Codex render tree at `packages/happy-app/sources/components/tools/views/CodexBashView.tsx` and surrounding Codex view files so spawn/wait/resume/close agent tool calls produce a card and a detail-panel entry.

**§5.14 — Codex multi-file edit, no right-sidebar rendering**
- 1. When Codex performs a multi-file edit operation, the right-side detail panel does NOT render the change set — there is no parallel to Claude Code's multi-file edit detail view.
- 2. Expected: Codex multi-file edits must open / populate the right-side detail panel with per-file diff (same component, or an equivalent component sharing the same layout / interaction pattern as Claude Code's multi-file edit panel).
- 3. Interaction parity: clicking the tool-call card in the conversation should open the detail panel; the panel should let the user navigate per file; diff rendering should match Claude Code's treatment (unified or split).
- 7. Alignment with §5.14: `functions.apply_patch` (when spanning multiple files) must route into the shared multi-file edit detail panel — resolving §5.14.
- Dev must route `functions.apply_patch` into the shared multi-file edit detail panel that Claude Code already uses, sharing the same per-file diff component.

**§5.15 — Codex tool coverage (all 26 tools)**
- 2. Expected coverage: every tool in the four groups above (A Web/realtime, B Local-exec/engineering, C Subagent/delegation, D Tool-suggest/plugin) must have a conversation card AND (where applicable) a right-side detail panel.
- 5. Alignment with §5.6: the Codex tool rendering layer must share the same redesigned popup / card primitives used by Claude Code — do not build a second divergent rendering tree.
- Dev entry points: `packages/happy-app/sources/components/tools/views/CodexBashView.tsx` + surrounding Codex view files; extend `knownTools.tsx` registration so every Codex tool (web.*, functions.*, multi_tool_use.parallel) routes to an inline card + detail-panel entry sharing the Claude Code primitives.

### 5.16 — Inline LaTeX math (delimiter recognition gap)

4. Context: the repo already has `packages/happy-app/sources/components/markdown/LatexRenderer.tsx` and related parse paths (`parseMarkdown.ts`, `parseMarkdownBlock.ts`), so the fix is most likely an activation / delimiter-recognition gap rather than a missing renderer — dev should verify whether the inline `$...$` delimiter is being detected by the parser and routed into `LatexRenderer`.

**§5.17 — Markdown primitives (same pipeline as §5.16)**
- 9. Scope: applies wherever `MarkdownView` is used (conversation, detail panel, feedback docs, tool-call result previews).
- 10. Alignment with §5.16 (LaTeX): this is the same `MarkdownView` / parser pipeline — fixes should be considered together, since a common parser-level gap could explain both.
- Dev scope: same `MarkdownView` / `parseMarkdown.ts` / `parseMarkdownBlock.ts` pipeline. Extend heading / blockquote / task-list / nested-list / strikethrough / kbd / HTML-entity renderer coverage.

**§5.18 — CronList inline simplification + sidebar retention**
- 2. **Simplify the inline card** (main conversation) to match the Bash / subagent rendering pattern:
   - Header with tool name + icon (`CronList` + wrench or clock icon).
   - ONE compact summary line showing the `input` arguments only (e.g., `CronList {}`), in the same style Bash uses for its command line and subagent uses for its invocation line.
   - No separate INPUT / OUTPUT sections inline.
- 3. **Preserve the current verbose rendering** (INPUT block + OUTPUT block) but move it to the RIGHT-SIDE SIDEBAR only. Clicking the simplified inline card opens the sidebar with the existing `INPUT / OUTPUT` layout.
- Dev scope: simplify the CronList tool card inline to a summary row (header + single input-summary line); move the verbose `INPUT` / `OUTPUT` block into `packages/happy-app/sources/components/RightSidebar.tsx` detail-panel content only.

---

## Section 2: What Was Attempted

<!-- WHO WRITES: Dev (after each implementation attempt) -->
<!-- WHAT: Per-cycle record of what approach was tried, what the rationale was, and why it failed (if it failed). -->
<!-- This prevents the next cycle's Dev from repeating the same approach. -->

### Cycle 1

_Not yet populated._

---

## Section 3: What Was Changed

<!-- WHO WRITES: Dev (after each implementation) -->
<!-- WHAT: Exact file changes with line numbers and old->new values. -->
<!-- FORMAT: - **file.tsx:42** -- `property: oldValue` -> `property: newValue` -->

### Cycle 1

_Not yet populated._
