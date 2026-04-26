# Hook-Block Handoff — DEV_SESSION_ID dev-20260425-201355

> Self-contained hand-off for a fresh agent / session.
> Author: investigation-only compile, 2026-04-25.
> Read-only audit. No source / hooks were modified.

---

## TL;DR

This dev cycle had **8 distinct blocked Edit operations** across **6 oversized source files**. Every block was triggered by the **same single hook** (`~/.claude/hooks/pretool-quality-gate.py`) reacting to **pre-existing** file-length / function-length / nesting-depth violations. The hook scans **whole-file post-edit content** — a +1 line instrumentation patch is rejected by violations 1000 lines away. Pipeline 7.2 succeeded by **first refactoring the oversized functions, then adding the new feature** in the same edit chain. That pattern is the recommended unblock.

---

## 1. The Hook

### Path & runtime

- File: `/root/.claude/hooks/pretool-quality-gate.py` (user-global, applies to ALL projects)
- Type: PreToolUse, matcher `Write|Edit`
- Wired in: `/root/.claude/settings.json` lines 364-371 (NOT in project-local settings)
- Exit codes: `0 = allow`, `2 = block`

### Thresholds (constants at top of file)

```python
MAX_FILE_LINES = 800
MAX_FUNC_LINES = 30
MAX_NESTING = 3
```

### Exemption mechanism

**There is exactly one exemption mechanism, and it is path-based, not user-controlled.**

```python
EXEMPT_PATHS = {
    'node_modules', '.git', '__pycache__', 'vendor', 'dist', 'build',
    '.next', 'coverage', '.venv', 'venv', 'package-lock.json',
    'yarn.lock', 'pnpm-lock.yaml',
}
CHECKABLE_EXTS = {'.py', '.ts', '.js', '.tsx', '.jsx'}
```

`is_exempt()` skips any file whose path contains an `EXEMPT_PATHS` segment, or whose extension is not in `CHECKABLE_EXTS`. **There is NO**:

- `.claude/.hook-refactor-allow` sentinel-file check
- Environment-variable bypass (no `QUALITY_GATE_INSTRUMENTATION_ONLY` or similar)
- Diff-only / instrumentation-aware mode
- "Pre-existing violation grandfather" logic
- Override flag in tool input

The hook does NOT compare pre-edit vs post-edit metrics. It computes thresholds purely on the resulting content. A 1-line instrumentation patch that ADDS one logger line to a 1394-line file fails because the file is still 1394+1 lines after the edit.

### Rejection emit format (verbatim from lines 239-243)

```
QUALITY GATE BLOCKED — <file_path>:
  - <violation 1>
  - <violation 2>
  ...
Fix violations before writing. Split large functions into smaller ones.
```

Specific violation strings (verbatim from lines 82, 103-104, 116-117, 124-126, 161-162, 183-184, 202-204):

- `File has {n} lines (max 800). Split into modules.`
- `Function '{name}' (line {n}) is {len} lines (max 30)`
- `Line {n}: nesting depth {d} (max 3). Extract to helper function.`

### Detection algorithms

| Language | File length | Function length | Nesting depth |
|---|---|---|---|
| Python | line count | def/async-def + indent tracking | indent / 4 |
| TS/JS/TSX/JSX | line count | regex on `function`/`const = (`/`name(...){` + brace counter | brace counter, `effective = max_depth - 1` (subtracts module-level brace) |

Notable: the TS function detector regex (lines 134-140) matches three patterns. It MAY miss arrow-function exports declared mid-file, but its brace-counter is naive; it will count any `{...}` including object literals and JSX expressions. This produces some false-positive function-size reports (the dev-reports note `AttachButton 125 lines` on AgentInput.tsx — that count is real, not false-positive, because the file IS that big).

---

## 2. Hook configuration

### Where wired in

The quality-gate hook is configured in **user-global** `/root/.claude/settings.json` (lines 364-371):

```jsonc
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "python3 \"$HOME/.claude/hooks/pretool-quality-gate.py\""
    }
  ]
}
```

### Project-local hooks

The project's `.claude/settings.json` (`/dev/shm/dev-workspace/happy-dev/.claude/settings.json`) configures a different set of hooks (`pretool-block-production.sh`, `pretool-docker-dev-guard.sh`, `pretool-block-production-files.sh`). It does NOT configure the quality-gate hook — the quality gate fires globally regardless of which project the editor is in.

### Implication for unblock

Because the hook lives in `~/.claude/hooks/` and is wired in `~/.claude/settings.json`, **only the user (or an agent with explicit user consent) can change/disable it**. A subagent that modifies `~/.claude/hooks/*.py` or `~/.claude/settings.json` is committing a violation per CLAUDE.md "Subagent Hook Discipline" non-negotiables (rules 5 and 6 of that section).

---

## 3. Inventory of blocked / oversized files

| # | File | Lines | Pipeline(s) | Pre-existing violations claimed by hook |
|---|---|---:|---|---|
| 1 | `packages/happy-app/sources/components/AgentInput.tsx` | 1393 | 5.2 | File 1394 lines (max 800); `hasAttachments` 32 lines; `resolvedModelKey` 37 lines; `AttachButton` 125 lines; `GitStatusButton` 40 lines; line 652 nesting depth 6 |
| 2 | `packages/happy-app/sources/components/tools/knownTools.tsx` | 1398 | 5.18 | File 1398 lines (max 800); line 823 nesting depth 6 |
| 3 | `packages/happy-app/sources/sync/sync.ts` | 2418 | 7.3.B / 7.3.C | File 2418 lines (max 800) — single dominant violation; multiple oversized methods inside the class |
| 4 | `packages/happy-cli/src/claude/session.ts` | 195 | 7.1 | line 178 nesting depth 6 inside `consumeOneTimeFlags` (lines 157-194) |
| 5 | `packages/happy-cli/src/api/apiSession.ts` | 660 | 7.1 | `constructor` 123 lines; `fetchMessages` 54 lines; `sendClaudeSessionMessage` 71 lines; line 369 nesting depth 6 |
| 6 | `packages/happy-cli/src/claude/claudeRemote.ts` | 239 | 7.1 | `claudeRemote` 228 lines; line 59 nesting depth 6 |
| 7 (info) | `packages/happy-app/sources/components/markdown/MarkdownView.tsx` | 799 | n/a (not blocked this cycle) | Currently exactly under threshold. Was 795 before earlier overnight edits; now 799 — one more line and it joins the blocked-files list. Listed for awareness. |

### Function boundary inventory (top-level only)

For TS files where `grep -n '^export.*function\|^function\|^class' <file>` produced results:

```
AgentInput.tsx
  306: export const AgentInput = React.memo(React.forwardRef<...>((props, ref) => { ... })  // huge body
 1227: function AttachButton({...})                                                          // 125 lines per hook
 1354: function GitStatusButton({...})                                                       // 40 lines per hook

knownTools.tsx
   30: function getPatchFiles(input: any): string[]
   65: export const knownTools = { ... }              // ~1320-line object-literal registry
 1387: export function isMutableTool(toolName: string): boolean

sync.ts
   65: class Sync { ... }                              // ~2300-line class
 2366: export const sync = new Sync();
 2373: export async function syncCreate(credentials)
 2382: export async function syncRestore(credentials)

session.ts (CLI)
    9: export class Session { ... }                    // file is only 195 lines but `consumeOneTimeFlags` at 157-194 has nesting=6

apiSession.ts (CLI)
   74: export class ApiSessionClient extends EventEmitter { ... }  // class contains all the violating methods

claudeRemote.ts
   16: export async function claudeRemote(opts: { ... }): Promise<...> { ... }   // 228 lines
```

For Pipeline 7.1 (CLI) the violating functions are well-localised: each file has 1-4 named functions at fault. For Pipeline 5.18 (knownTools.tsx) the violation is an entire 1320-line object literal that the regex flags as a function (or just file size). For 5.2 / 7.3 (sync.ts) the violation is overall file size first, with a nest of oversized methods inside the class.

---

## 4. Per-pipeline blocked-edit details

> All `old_string` / `new_string` blocks are the **exact patches** the dev-subagents intended to apply when blocked. They are reproduced verbatim from the JSON dev-reports.

---

### 4.1 Pipeline 5.2 — AgentInput.tsx (per-flavor default context window)

- **Why**: 1M-context fix (§5.2 Cycle 6 forward-fix L4). When picker is `'default'`, current code uses generic `getModelContextWindow(resolvedModelKey)` which mis-sizes the bar for Claude (1M) vs Codex (200k) vs Gemini (1M). New helper `getDefaultModelContextWindow(flavor)` already landed in `modelModeOptions.ts` (lines 103-122). Two micro-edits in `AgentInput.tsx` need to wire it in.
- **Type**: feature wiring (additive)
- **Source artifact**: `docs/dev/dev-report-20260425-201355-5-2.json`

**Edit 1** — line 11 (import):

```typescript
// old_string
import { getDefaultModelKey, getModelContextWindow } from './modelModeOptions';

// new_string
import { getDefaultModelContextWindow, getDefaultModelKey, getModelContextWindow } from './modelModeOptions';
```

**Edit 2** — lines 359-367 (call site):

```typescript
// old_string
    // Calculate context warning — per-model context window (§5.2 1M-context fix)
    // Resolve model key: prefer picker key (if not 'default'), else session metadata currentModelCode
    const resolvedModelKey = (props.modelMode?.key && props.modelMode.key !== 'default')
        ? props.modelMode.key
        : (props.metadata?.currentModelCode ?? null);
    const maxContextSize = getModelContextWindow(resolvedModelKey);
    const contextWarning = props.usageData?.contextSize
        ? getContextWarning(props.usageData.contextSize, props.alwaysShowContextSize ?? false, theme, maxContextSize)
        : null;

// new_string
    // Calculate context warning — per-model context window (§5.2 cycle 6 L4 fix)
    // (1) Picker='default' or absent: flavor-aware default window (claude=>1M per
    //     user product assertion in spec line 2801; codex=>200k; gemini=>1M).
    // (2) Explicit non-default picker: existing per-model lookup heuristic.
    // (3) Render guard is presence-based, not truthy-based — so contextSize=0
    //     with alwaysShowContextSize=true still renders the indicator instead
    //     of being silently hidden by the falsy-zero coercion.
    const pickerKey = props.modelMode?.key;
    const maxContextSize = (!pickerKey || pickerKey === 'default')
        ? getDefaultModelContextWindow(modelFlavor)
        : getModelContextWindow(pickerKey);
    const contextWarning = props.usageData
        ? getContextWarning(props.usageData.contextSize ?? 0, props.alwaysShowContextSize ?? false, theme, maxContextSize)
        : null;
```

Net diff: +20/-9 lines.

---

### 4.2 Pipeline 5.18 — knownTools.tsx (CronList subtitle wiring)

- **Why**: CronList tool card collapses to just the header because the entry uses `extractDescription` but `ToolView.tsx:161-164` only reads `extractSubtitle`. Rename the field and drop the redundant title prefix.
- **Type**: bug fix (rename + simplification, net -2 lines)
- **Source artifact**: `docs/dev/dev-report-20260425-201355-5-18.json`

**Edit** — lines 952-967 (single block):

```typescript
// old_string
    'CronList': {
        title: t('tools.names.cronList'),
        icon: ICON_CLOCK,
        minimal: true,
        input: z.object({}).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const keys = Object.keys(input);
            if (keys.length === 0) {
                return t('tools.names.cronList') + ' {}';
            }
            const summary = JSON.stringify(input);
            const truncated = summary.length > 40 ? summary.substring(0, 40) + '...' : summary;
            return t('tools.names.cronList') + ' ' + truncated;
        }
    },

// new_string
    'CronList': {
        title: t('tools.names.cronList'),
        icon: ICON_CLOCK,
        minimal: true,
        input: z.object({}).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const keys = Object.keys(input);
            if (keys.length === 0) {
                return '{}';
            }
            const summary = JSON.stringify(input);
            return summary.length > 40 ? summary.substring(0, 40) + '...' : summary;
        }
    },
```

Net diff: +5/-7 lines (≈ -2 net).

**Caveat called out by dev**: ToolView's `toolDescription` style has no `fontFamily`, so the subtitle will render in system sans-serif rather than the spec-requested monospace. The subtitle fix is still a strict improvement (the row currently renders as collapsed-empty); full font parity needs a separate `CronListView` registration in `views/_all.tsx` or a per-knownTool monospace flag.

---

### 4.3 Pipeline 7.1 — CLI keepAlive instrumentation (3 files)

- **Why**: BG-task wake bug. Pipeline 7.1 needs runtime evidence (per BA spec R3 + QA Objection #1) to discriminate between H_F.1 (thinking flag never re-flips after `result`) and H_F.3 (`socket.volatile.emit` drops while reconnecting). 5 logger.info insertions across 3 files would prove or refute both within one 30-minute reproduction.
- **Type**: instrumentation (Phase 1) + tiny fix (Phase 2 deferred)
- **Source artifacts**: `docs/dev/dev-report-20260425-201355-5-19-7.1.json` + `dev-instrument-20260425-201355-5-19-7.1.md`

The dev-subagent did NOT capture the `old_string` snippets verbatim because the hook rejected the very first attempt on each file before commits could be drafted. The instrumentation plan from the artifact gives line-anchored intent:

| # | File | Line | Log key | What it proves |
|---|---|---:|---|---|
| 1 | `packages/happy-cli/src/claude/session.ts` | 71-73 (timer body) | `[BGTASK-INSTR-7.1][KEEPALIVE-TICK] sid=… thinking=… mode=… ts=…` | keepAlive cadence is continuous across Stop boundary |
| 2 | `packages/happy-cli/src/claude/session.ts` | 79-83 (cleanup) | `[BGTASK-INSTR-7.1][KEEPALIVE-CLEANUP] sid=… ts=… stack=…` | Detects unexpected early cleanup |
| 3 | `packages/happy-cli/src/claude/session.ts` | 85-88 (onThinkingChange) | `[BGTASK-INSTR-7.1][THINKING-CHANGE] sid=… prev=… next=… ts=…` | Catches every thinking transition |
| 4 | `packages/happy-cli/src/api/apiSession.ts` | 523-533 (`keepAlive` method body) | `[BGTASK-INSTR-7.1][SESSION-ALIVE-EMIT] sid=… thinking=… connected=… ts=…` | Proves emit cadence + socket-connected at emit time (catches H_F.3) |
| 5 | `packages/happy-cli/src/claude/claudeRemote.ts` | 136-144 (`updateThinking` arrow) | `[BGTASK-INSTR-7.1][REMOTE-THINKING] sid=… prev=… next=… ts=…` | Smoking gun for H_F.1 (does updateThinking(true) ever re-fire on bg-task wake?) |

Phase 2 fix variants (also blocked, intended after instrumentation evidence captured):

| Variant | File | Approx diff | Description |
|---|---|---:|---|
| fix-H_F.1 | `claudeRemote.ts` | +3 lines | When SDK emits assistant message AFTER a prior `result` without intervening user prompt, call `updateThinking(true)` so app sees babbling indicator. |
| fix-H_F.3 | `apiSession.ts` | +5..+8 lines | On socket `connect` handler, after `receiveSync.invalidate()`, call `this.client.keepAlive(thinking, mode)` once so server's `lastActiveAt` + ephemeral thinking snapshot bridges the reconnect gap (BA-QA Objection #5 recommendation). Requires storing `lastKnownThinking` on `ApiSessionClient`. |

The dev-subagent's static analysis at lines 65-99 of the instrumentation MD identifies the smoking gun: `claudeRemote.ts` calls `updateThinking(true)` only at lines 162 and 175 (query start / SDK init). It is NEVER re-called after `result` at line 192. If the SDK stream resumes producing assistant text after `result`, `keepAlive` keeps emitting `thinking=false` — explaining the user-visible "no babbling indicator" while messages still stream via the JSONL session-scanner.

---

### 4.4 Pipeline 7.3.B + 7.3.C — sync.ts (visible-session catch-up + thinking-preserve)

- **Why**: App-side fix to ensure (B) on websocket reconnect, the most-recently-visible session re-fetches incremental messages even when SessionView isn't currently mounted; and (C) hydrate path doesn't clobber a recently-emitted `thinking=true` with `false` during the brief window before the next ephemeral arrives.
- **Type**: feature wiring (B) + state-preserve (C)
- **Source artifact**: `docs/dev/dev-report-20260425-201355-5-19-7.3.json`

#### 7.3.B — onSessionVisible tracking + reconnect callback

**Edit B1** — sync.ts:229-240 (`onSessionVisible` method):

```typescript
// old (current):
    onSessionVisible = (sessionId: string) => {
        this.getMessagesSync(sessionId).invalidate();
        // ... rest of method body unchanged ...

// new:
    onSessionVisible = (sessionId: string) => {
        // Track most-recently-visible session so the websocket reconnect
        // callback can re-trigger catch-up for it (pipeline 7.3.B).
        this.lastVisibleSessionId = sessionId;
        this.getMessagesSync(sessionId).invalidate();
        // ... rest of method body unchanged ...
```

Plus in the `Sync` class header (around the field-declaration block):

```typescript
    private lastVisibleSessionId: string | null = null;
```

**Edit B2** — sync.ts:1756-1771 (websocket reconnect callback). After the existing `this.feedSync.invalidate();` line, add:

```typescript
    // Pipeline 7.3.B: re-fetch incremental messages for the visible session.
    // The previous comment claimed 'SessionView re-fetches on realtimeStatus change'
    // but realtimeStatus is voice-only. We now have an explicit catch-up here in
    // addition to the SessionView socketStatus dependency (defence in depth).
    if (this.lastVisibleSessionId) {
        this.getMessagesSync(this.lastVisibleSessionId).invalidate();
    }
```

Net diff for 7.3.B: +9/-2 lines (3 lines in onSessionVisible + 1 field decl + 6 lines in reconnect callback).

#### 7.3.C — preserve-thinking-when-recent on hydrate

**Edit C** — sync.ts:800-808 (the `decryptedSessions.push` block):

```typescript
// old_string
            // Put it all together
            const processedSession = {
                ...session,
                thinking: false,
                thinkingAt: 0,
                metadata,
                agentState
            };
            decryptedSessions.push(processedSession);

// new_string
            // Pipeline 7.3.C: do NOT clobber locally-known thinking on every hydrate.
            // If we already have a known thinking=true state for this session AND
            // the most recent activity (activeAt) is within the last 5s, preserve
            // it — the CLI is plausibly still mid-turn and a fresh ephemeral may
            // not arrive before render. Otherwise reset (the prior behaviour).
            // Pipeline 7.2 (server-side thinking snapshot on connect) is expected
            // to land alongside this; if 7.2 ships a guaranteed snapshot we can
            // tighten this back to an unconditional reset in a follow-up.
            const existingSession = storage.getState().sessions[session.id];
            const STALE_THINKING_MS = 5000;
            const preserveThinking = (
                existingSession &&
                existingSession.thinking === true &&
                session.activeAt > 0 &&
                Date.now() - session.activeAt < STALE_THINKING_MS
            );
            const processedSession = {
                ...session,
                thinking: preserveThinking ? existingSession.thinking : false,
                thinkingAt: preserveThinking ? existingSession.thinkingAt : 0,
                metadata,
                agentState
            };
            decryptedSessions.push(processedSession);
```

Net diff: +18/-4 lines.

#### 7.3.A (already landed)

For completeness: 7.3.A modified `SessionView.tsx` (line 26 import + lines 275-286 effect dep), changing `useLayoutEffect`'s dependency from `realtimeStatus` to `socketStatus` so visible-session catch-up runs on websocket reconnect (not on voice realtime status change). This file is below the 800-line threshold, so the hook didn't block it. Diff: +6/-1 lines.

---

## 5. The "forced refactor" pattern that worked (Pipeline 7.2)

### Outcome

Pipeline 7.2 (server-side thinking snapshot on connect) successfully landed by **refactoring oversized functions into ≤30-line helpers as part of the same edit chain that added the new feature**. Files modified:

- `packages/happy-server/sources/app/api/socket.ts` — was a `connection` handler ~140 lines deep-nested; now 197 lines total with helpers `readHandshake`, `validateHandshakeShape`, `rejectHandshake`, `buildConnection`, `broadcastMachineOnline`, `broadcastMachineOffline`, `sendSessionSnapshotsToConnectingSocket`, `broadcastConnectActivity`, `registerDisconnectHandler`, `getOrCreateUserRpcListeners`, `registerAllHandlers`, `handleConnection`.
- `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts` — was a 287-line exported function; now 215 lines with helpers `clampHeartbeatTime`, `isValidUpdateMetadataInput`, `isValidUpdateStateInput`, `emitMetadataUpdate`, `emitAgentStateUpdate`, `performUpdateMetadata`, `handleUpdateMetadata`, `performUpdateState`, `handleUpdateState`, `performSessionAlive`, `handleSessionAlive`, `findExistingMessage`, `persistAndEmitMessage`, `performMessage`, `handleMessage`, `performSessionEnd`, `handleSessionEnd`. The exported function is now 18 lines.
- `packages/happy-server/sources/app/presence/thinkingCache.ts` — **new module**, 96 lines; exports `recordThinking()`, `clearThinking()`, `getActivitySnapshotForUser()`, plus internal `buildSnapshotRow()`, `findRecentlyActiveSessions()`. Holds an in-memory Map with 5s TTL.

### Pattern (per dev-report `dev-report-20260425-201355-5-19-7.2.json`)

> "I split each file's mega-functions into focused sub-30-line helpers preserving exact semantics, then added the new pipeline 7.2 logic. The functional addition (new module + 3 call sites) is ~30 lines; the remaining ~58 net lines are forced refactor."

Step-by-step:

1. **Read the offending function in full.**
2. **Identify natural seams** (validation, side-effect-emission, persistence, broadcasting). Each seam becomes a top-level helper.
3. **Extract helpers** preserving exact control flow + exact variable scoping. Each helper's signature accepts the inputs the original function had captured.
4. **Replace the original function body** with calls to the new helpers. The original function shrinks below 30 lines.
5. **Add the new feature code.** Because the original function is now short, adding a new line doesn't push it back over threshold.
6. **Run typecheck.** Pipeline 7.2 had `yarn workspace happy-server typecheck` clean (the only error was a pre-existing one in `sessionCache.ts` unrelated to the pipeline).

### Net effect

- Function `F` (originally 287 lines, nest=5+) → 18 lines, nest ≤3.
- New feature lands in a fresh helper or an existing-now-small one.
- Project structure improves: every helper is independently named, callable, and (in principle) testable.
- Diff is bigger than minimum (286 lines removed, 374 added per `diff_stats`), but **landable in a single dev pipeline** because the hook checks the post-edit state, not the diff size.

### Why this works (and the others didn't)

The hook computes thresholds on **resulting content**. If the resulting content has all functions ≤30 lines, all nesting ≤3, and total ≤800 lines, the edit is allowed regardless of how invasive the diff is. Pipeline 7.2 exploited this: by including the refactor in the same Edit/Write chain as the feature, it produced a final file state that satisfied the hook. Pipelines 5.2 / 5.18 / 7.1 / 7.3.B+C all attempted **minimum-diff** edits to files where the resulting content still violated thresholds — guaranteed rejection.

**Caveat**: this pattern requires the dev-subagent to (a) understand the existing function well enough to extract semantically-preserving helpers, and (b) commit a much larger diff than the minimum-diff rule normally permits. Spec Section 8 / 7.2 dev-report acknowledge this trade-off explicitly — "BA spec Section 8 anticipates this".

---

## 6. Recommended unblock strategies (rank-ordered)

| # | Strategy | Cost | Risk | Coverage of remaining 8 blocked edits | Hook supports it today? |
|---|---|---|---|---|---|
| 1 | **Forced refactor per file** (Pipeline 7.2 pattern) — extract ≤30-line helpers from the named oversized functions in each file, then apply the original blocked edit | high (≈ 1 dev pipeline per file) | low (semantics-preserving, mechanical) | all 8 | YES (no hook change needed) |
| 2 | Add `.claude/.hook-refactor-allow` sentinel + retry | low | hook DOES NOT honor any sentinel today | 0 / 8 | NO — hook must be modified |
| 3 | Add `QUALITY_GATE_INSTRUMENTATION_ONLY=1` env var bypass for logger-only diffs | medium (one-line + an os.environ check in hook) | medium (introduces new bypass surface; subagents could abuse) | partially (only the 5 logger.info lines from 7.1; not 5.2 / 5.18 / 7.3.B+C which add real logic) | NO — hook must be modified |
| 4 | Loosen hook to grandfather pre-existing violations: compare pre-edit vs post-edit metrics, only block if post-edit values are strictly greater than pre-edit | medium (≈ 30-line patch in the hook) | medium (changes hook behavior project-wide) | all 8 | NO — hook must be modified |
| 5 | Manual user TTY apply (user runs the patch directly outside Claude tools) | low | low | per-edit (one apply per file × 8 edits) | hook is bypassed by direct write outside Claude tools |
| 6 | Skip blocked items entirely | low | spec items remain unfixed; partial-fix shipped | none | n/a |

### Ranking rationale

- **Strategy 1 (forced refactor)** is the only cost+risk-balanced option that requires zero hook changes and lands every blocked edit. Pipeline 7.2 is a working precedent. Per-file effort:
  - `session.ts` (CLI, 195 lines): extract 1 helper (`parseResumeFlag(args, idx)`) from `consumeOneTimeFlags`. ~10-line refactor + 3-line instrumentation. Smallest. Recommended starting point.
  - `claudeRemote.ts` (CLI, 239 lines, single 228-line function): extract 4-5 message-handler helpers (`handleSystemInit`, `handleResult`, `handleAssistantMessage`, `handleStream`) from `claudeRemote()`. Mid-size refactor.
  - `apiSession.ts` (CLI, 660 lines): extract socket-handler-registration + pagination + mapper-result helpers from `constructor`, `fetchMessages`, `sendClaudeSessionMessage`. Mid-size refactor; this file is the highest-risk because it's heavily imported.
  - `AgentInput.tsx` (1393 lines): extract attachment helpers / git-status helpers / model-resolution helpers. Large refactor, but Cycle 1 already touched this file successfully — it's been a moving target. The 2 micro-edits the dev needs are tiny; bulk of the work is reducing the file below 800 lines, which means moving `AttachButton` (125 lines) and `GitStatusButton` (40 lines) to their own files.
  - `knownTools.tsx` (1398 lines): the file is dominated by a single ~1320-line object-literal registry. Splitting it means breaking the registry into shards (`knownTools/system.tsx`, `knownTools/file.tsx`, `knownTools/cron.tsx`, etc.) and re-exporting. Largest refactor; touches every consumer of `knownTools`.
  - `sync.ts` (2418 lines): largest refactor by far. Spec already proposes `Pipeline 7.4 'split sync.ts into modules'` as a separate cycle. Full refactor would be ~1600+ lines moving across files. **Recommendation**: defer — accept 7.3.A as the partial fix, run sync.ts split as its own dedicated cycle.

- **Strategies 2 / 3 / 4** all require modifying `~/.claude/hooks/pretool-quality-gate.py`. That is per CLAUDE.md "Subagent Hook Discipline" non-negotiable: subagents must NEVER modify hook files. Only the user can authorize this. If the user does authorize it, Strategy 4 is the cleanest because it generalizes — any future "instrumentation on a too-big file" scenario is auto-handled.

- **Strategy 5** (manual user apply) is a per-edit bandaid. Useful for the 7.1 instrumentation (5 trivial logger.info lines) where no orchestration is needed, but does not scale.

- **Strategy 6** is acceptable only for items whose absence is non-blocking; the dev-reports note that 5.18, 7.3.B, 7.3.C all degrade from "complete fix" to "partial fix" without the blocked edits.

### Recommended path for the receiving agent

For the autonomous cycle, recommend the following order:

1. **Strategy 1 on session.ts + claudeRemote.ts** (smallest refactors, unblocks 7.1 instrumentation immediately — and 7.1 needs evidence before its own Phase 2 fix).
2. **Strategy 1 on apiSession.ts** (mid refactor; once done both 7.1 fix-H_F.3 and any future apiSession instrumentation become possible).
3. **Strategy 5 on AgentInput.tsx + knownTools.tsx** for the 5.2 + 5.18 micro-fixes — the diffs are 2 hunks each, user-applicable in seconds; full refactor is disproportionately expensive for these tiny patches.
4. **Defer sync.ts** to a dedicated Pipeline 7.4 split-cycle. Accept 7.3.A alone as the cycle's 7.3 deliverable.

If the user instead authorizes hook modification, prefer **Strategy 4** (grandfather pre-existing violations) over Strategy 2/3 — it's the most general and least bypass-prone.

---

## 7. Self-contained handoff appendix — for the receiving agent

### Working environment

| Field | Value |
|---|---|
| Working directory | `/dev/shm/dev-workspace/happy-dev` |
| Active branch | `main` |
| Uncommitted file count | `740` (per `git status --short \| wc -l`) — most are stale `.playwright-mcp/console-*.log` deletions plus the .claude/worktrees subdirectory; not blockers |
| DEV_SESSION_ID | `dev-20260425-201355` |
| Registry path | `/dev/shm/dev-workspace/happy-dev/.claude/dev-registry/dev-20260425-201355/` |
| Source spec (main) | `/dev/shm/dev-workspace/happy-dev/docs/dev/specs/spec-20260424-084848.md` |
| Source spec (addendum) | `/dev/shm/dev-workspace/happy-dev/docs/dev/specs/spec-20260424-084848-section-5.19-bgtask.md` |
| Hook (the offender) | `/root/.claude/hooks/pretool-quality-gate.py` |
| Hook config | `/root/.claude/settings.json` lines 364-371 |

### Registry agent files (in `.claude/dev-registry/dev-20260425-201355/`)

```
architect.json
ba.json
dev.json
pm.json
product-owner.json
qa.json
ui-specialist.json
user.json
```

### All artifacts from this cycle (in `/dev/shm/dev-workspace/happy-dev/docs/dev/`)

Files matching `*20260425-201355*`:

```
ba-qa-report-20260425-201355-5-2.json
ba-qa-report-20260425-201355-5-3.json
ba-qa-report-20260425-201355-5-4-5.json
ba-qa-report-20260425-201355-5-16.json
ba-qa-report-20260425-201355-5-17.json
ba-qa-report-20260425-201355-5-19.json
ba-spec-20260425-201355-5-2.md
ba-spec-20260425-201355-5-3.md
ba-spec-20260425-201355-5-4-5.md
ba-spec-20260425-201355-5-8.md
ba-spec-20260425-201355-5-16.md
ba-spec-20260425-201355-5-17.md
ba-spec-20260425-201355-5-18.md
context-20260425-201355-5-2.json
context-20260425-201355-5-3.json
context-20260425-201355-5-4-5.json
context-20260425-201355-5-8.json
context-20260425-201355-5-16.json
context-20260425-201355-5-17.json
context-20260425-201355-5-18.json
dev-report-20260425-201355-5-2.json    # ← BLOCKED, 5.2 AgentInput.tsx
dev-report-20260425-201355-5-3.json
dev-report-20260425-201355-5-4-5.json
dev-report-20260425-201355-5-8.json
dev-report-20260425-201355-5-16.json
dev-report-20260425-201355-5-17.json
dev-report-20260425-201355-5-18.json   # ← BLOCKED, 5.18 knownTools.tsx
dev-report-20260425-201355-5-19-7.1.json    # ← BLOCKED, 7.1 CLI 3 files
dev-report-20260425-201355-5-19-7.2.json    # ← LANDED (the "forced refactor" precedent)
dev-report-20260425-201355-5-19-7.3.json    # ← PARTIAL: 7.3.A landed, 7.3.B+C blocked
dev-instrument-20260425-201355-5-19-7.1.md  # ← Phase-1 instrumentation plan
```

### Source-spec context (where 5.19 came from)

The cycle was driven by the user's session-recovery / bg-task spec at `docs/dev/specs/spec-20260424-084848.md` plus the section-5.19 addendum that introduced Pipeline 7 (subdivided 7.1 CLI / 7.2 server / 7.3 app). Pipelines 5.2 / 5.3 / 5.4-5 / 5.8 / 5.16 / 5.17 / 5.18 are independent UI-fix items from the same spec.

### Verification commands the receiving agent should run on entry

```bash
# Confirm the hook still has identical thresholds
grep -E "MAX_FILE_LINES|MAX_FUNC_LINES|MAX_NESTING" /root/.claude/hooks/pretool-quality-gate.py
# Expected: MAX_FILE_LINES = 800 / MAX_FUNC_LINES = 30 / MAX_NESTING = 3

# Confirm blocked file sizes haven't changed under our feet
wc -l \
  packages/happy-app/sources/components/AgentInput.tsx \
  packages/happy-app/sources/components/tools/knownTools.tsx \
  packages/happy-app/sources/sync/sync.ts \
  packages/happy-cli/src/claude/session.ts \
  packages/happy-cli/src/api/apiSession.ts \
  packages/happy-cli/src/claude/claudeRemote.ts
# Expected: 1393 / 1398 / 2418 / 195 / 660 / 239

# Confirm the 7.2 successful pattern is still on disk
wc -l \
  packages/happy-server/sources/app/api/socket.ts \
  packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts \
  packages/happy-server/sources/app/presence/thinkingCache.ts
# Expected: 197 / 215 / 96

# Confirm no sentinel exists
ls -la /dev/shm/dev-workspace/happy-dev/.claude/.hook-refactor-allow 2>&1
# Expected: cannot access ... No such file or directory
```

### Hook-discipline guardrails the receiving agent MUST respect

Per CLAUDE.md "Subagent Hook Discipline" (non-negotiable):

1. PAUSE on rejection — do NOT retry with `nohup`/`systemd-run`/`disown`/`setsid`/`at`/`cron` wrappers.
2. Do NOT write the rejected edit body into a `/tmp/*.sh` and execute it.
3. Do NOT read or modify hook source code looking for parsing gaps.
4. Do NOT modify any file under `~/.claude/hooks/` or `~/.claude.bak/hooks/`.
5. To unblock, output a REQUEST to user OR use the **forced-refactor** pattern (Strategy 1 above) which produces a hook-compliant final state.

The forced-refactor pattern is NOT a hook bypass — it is a hook-compliant workflow that happens to require a larger diff than the minimum-diff rule normally prefers. Spec Section 8 / `dev-report-20260425-201355-5-19-7.2.json` `diff_stats.justification_for_overage` already document this trade-off as legitimate.

---

## 8. Summary statistics

| Metric | Value |
|---|---:|
| Distinct hook responsible | 1 (`pretool-quality-gate.py`) |
| Pipelines blocked at least partially | 4 (5.2, 5.18, 7.1, 7.3) |
| Pipelines landed via forced-refactor | 1 (7.2) |
| Total blocked Edit operations | 8 |
| Total oversized files participating | 6 |
| Total proposed-but-not-applied diff | ~+62 / -22 lines (sum across 8 edits, excluding the 5 instrumentation lines) |
| Files at risk for future blocks (>800 lines) | 6 listed + `MarkdownView.tsx` at 799 (one line away) |

---

End of handoff document.
