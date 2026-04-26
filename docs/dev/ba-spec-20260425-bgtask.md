# BA Specification: Background-Task Notification Not Refreshing in Real-Time

**Request ID**: dev-20260425-bgtask
**Created**: 2026-04-25T21:00Z
**Standalone issue** (NOT in spec-20260424-084848.md)
**Status**: `ready` with `evidence_type: mixed (observed + inferred)` and `diagnosis_completeness: incomplete (no DevTools/network capture of the missing push)`

## Goal

Find why claude-code's text response to a `<task-notification>` system-reminder (which is injected when a backgrounded subagent finishes) is delivered to `happy-server` but is **NOT** rendered in the `happy-app` UI in real-time. The user must send another message to "kick" the app into displaying queued agent responses. The user explicitly said this is a regression: "重新出现了" — previously fixed, now back.

## Context

User-visible behaviour (verbatim):

> 刚刚后台任务导致 happy session 不更新的问题重新出现了。只有用户重新发消息才会收到后台任务结束了 claude 的反映（响应/输出）。这个是很严重的问题。

Architecturally relevant facts:

1. `happy-cli` runs claude-code via `@anthropic-ai/claude-code` SDK in stream-json mode (`packages/happy-cli/src/claude/sdk/query.ts:287`)
2. Each SDK message goes through `claudeRemoteLauncher.buildOnMessage` → `SDKToLogConverter` → `OutgoingMessageQueue.enqueue` → `ApiSessionClient.sendClaudeSessionMessage` → `pendingOutbox` → `flushOutbox` → `POST /v3/sessions/:id/messages` (`packages/happy-cli/src/claude/claudeRemoteLauncher.ts:163-176`, `packages/happy-cli/src/api/apiSession.ts:313-338`).
3. Server stores message + emits WebSocket `update` (`new-message`) via `eventRouter.emitUpdate` with `recipientFilter: 'all-interested-in-session'` (`packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts:198-217`).
4. `happy-app` `Sync.handleUpdate` at `packages/happy-app/sources/sync/sync.ts:1774` decrypts, normalizes, and calls `enqueueMessages` → reducer → Zustand `applyMessages` (`packages/happy-app/sources/sync/storage.ts:504-609`) → React-Native FlashList re-render.
5. `<task-notification>` is **silently swallowed** by `getSystemInjectedServiceText()` at `sessionProtocolMapper.ts:855-883` (no envelope emitted) AND by `apiSession.ts:384-389` (suppress legacy duplex) — this is intentional (Bug 12B). So the task-notification itself never appears in the app, only Claude's text response to it should.

## Setup / Environment

- **viewport**: BOTH desktop (1280×720 observed) AND mobile (per user screenshot showing iOS Safari)
- **theme**: light
- **locale**: zh-Hans
- **auth_state**: logged-in (dev account `cmi5mv9eh00wzpg14ph73jj3n`)
- **data_state**: active session with `Agent` tool used in `run_in_background: true` mode; subagent finished while orchestrator still running
- **browser**: Chromium via Playwright MCP (web). User reproduced on iOS Safari mobile via screenshot
- **url_path**: `https://dev.life-ai.app/session/<id>` — observed live at `cmoeru0d58tvtnz15wbhcrrru`

## Evidence (Contract A) — observed live

### Observed (BA's own Playwright session at `cmoeru0d58tvtnz15wbhcrrru`)

Captured 2026-04-25T21:00Z. The current dev session that the user is operating in itself exhibits the bug:

DOM evidence: messages e186-e258 show a sequence of agent responses (turns marked `BA: 后台任务通知不实时刷新调查`, "/dev/shm/dev-workspace/happy-dev attachment", four-option choice list) ending with the user's most recent prompt e265 = "结束了？" — which is the text the user typed AFTER staring at a static screen, knowing the app had pending agent text.

Composer state shows `actioning…` (i.e. `session.thinking === true`), proving the session IS active and an SDK call is in progress; nonetheless the immediately-preceding agent text only rendered when the user pressed Send on "结束了？".

Screenshot: `bg-task-bug-current-session.png` (saved to `.playwright-mcp/`).

### Observed (user-supplied)

User screenshot (referenced as `/tmp/happy-attachments/f28c26bb-f457-4a3c-a096-8371cd37601f-image.png`): mobile iOS Safari. After several minutes of "actioning" silence, user typed a prompt and 5 queued agent messages appeared at once.

### Measured (read directly from source)

| Layer | File:line | Measured value |
|---|---|---|
| CLI batches outbox latest-first | `packages/happy-cli/src/api/apiSession.ts:313-338` | `splice(-batchSize, batchSize)` — newest 50 sent in batch 1, older messages in subsequent batches |
| Server assigns seq in receipt order | `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts:160-188` | `inTx` create() loop assigns `seq` per insertion order |
| Server emits `new-message` per created message | `v3SessionRoutes.ts:198-217` | `eventRouter.emitUpdate({ recipientFilter: 'all-interested-in-session' })` per created message |
| App handles `new-message` | `packages/happy-app/sources/sync/sync.ts:1784-1866` | Fast-path requires `incomingSeq === currentLastSeq + 1`; else `getMessagesSync(sid).invalidate()` |
| App pings session visibility | `sync.ts:1871` | `this.onSessionVisible(updateData.body.sid)` called UNCONDITIONALLY at end of `new-message` handler — invalidates `getMessagesSync` regardless |
| App fetchMessages cursor advance | `sync.ts:1675-1685` | Advances `sessionLastSeq` BEFORE decrypt/normalize (so decrypt/normalize errors don't stall the loop, but ALSO don't re-deliver) |
| Reducer ordering | `packages/happy-app/sources/sync/storage.ts:556-557` | Sorts by `createdAt` desc, NOT by seq |
| `<task-notification>` suppression | `packages/happy-cli/src/claude/utils/sessionProtocolMapper.ts:675-678, 855-859` | Returns `{currentTurnId, envelopes: []}` — emits nothing |
| `<task-notification>` legacy suppression | `packages/happy-cli/src/api/apiSession.ts:384-389` | `isSwallowedByMapper` skips legacy `output` envelope |

### Expected (from architecture intent)

- Every claude assistant text should appear in app within ~200ms of being emitted by the SDK
- Specifically: text emitted AFTER claude-code injects `<task-notification>` (i.e. claude's reaction to "your background task finished") should render in the same path as any other in-turn assistant text
- `sessionLastSeq` advance on the app side must NOT skip the just-arrived seq

### Gap (between measured and expected)

User can prove a gap exists at the rendering layer (text only renders when user sends new message), but BA could NOT capture the exact seq numbers / WebSocket frames during a backgrounded-subagent completion. The exact failure point on the four candidate hops (CLI flushOutbox / server emitUpdate / WebSocket transport / app handleUpdate) is **NOT directly observed**. Two strong hypotheses below; either is sufficient to reproduce the user's symptom; both should be ruled in/out by dev with one DevTools session.

## Scope (Contract B)

**Search seed**: claude assistant text emitted between `<task-notification>` injection and the next `result` SDK message.

**Search scope**: `packages/happy-cli/src/{claude,api}`, `packages/happy-server/sources/app/{events,api/routes,api/socket}`, `packages/happy-app/sources/sync`.

**User reported**: 1 file (the app — wherever rendering "freezes")

**Additional found via grep**:
- `packages/happy-cli/src/api/apiSession.ts:313-348` (flushOutbox latest-first batching, enqueueMessage)
- `packages/happy-cli/src/api/apiSession.ts:355-425` (sendClaudeSessionMessage → mapper + legacy duplex paths)
- `packages/happy-cli/src/claude/utils/sessionProtocolMapper.ts:531-608, 671-693, 855-883` (assistant text and `<task-notification>` swallow)
- `packages/happy-cli/src/claude/utils/OutgoingMessageQueue.ts:1-191` (250ms-per-tool-call delayed enqueue + `releaseToolCall`)
- `packages/happy-cli/src/claude/claudeRemoteLauncher.ts:147-176` (delay heuristic for `assistant` messages with tool_use blocks)
- `packages/happy-app/sources/sync/sync.ts:1774-1872` (handleUpdate `new-message` branch, fast-path / fallback fetch)
- `packages/happy-app/sources/sync/sync.ts:1577-1627` (flushOutbox app-side: seq-gap detection)
- `packages/happy-app/sources/sync/storage.ts:504-609` (applyMessages reducer + Zustand set)

**All occurrences** (relevant to root cause): listed above.

## Reference Source (Contract C)

- **Tier**: tier_2_verified — own session source-tree read directly by BA + observed live UI behaviour at `cmoeru0d58tvtnz15wbhcrrru`. No external authoritative spec exists for "how a Claude-Code background task notification should be relayed to a third-party UI" — this is project-internal protocol.
- **Source**: prior fix commits in this repository document the family of bugs (see Prior Attempts).
- **Location**: `packages/happy-app/sources/sync/sync.ts:1612-1626` (existing seq-gap detection from commit `ae29dd3e`); `packages/happy-cli/src/api/apiSession.ts:313-338` (latest-first batching from commit `5a08be71`).
- **Copy allowed**: yes (project-internal, current git HEAD).
- **Dev constraint**: Dev MUST capture runtime evidence (DevTools Network panel + ws frames + happy-cli log + happy-server log) for at least one reproduction before committing a fix. Inferred-only fix is forbidden — see Prior Attempts: this exact symptom returns when fixes are made without runtime evidence.

## Prior Attempts (Contract D) — TRIGGERED

- **Triggered**: yes
- **Trigger source**: user_phrasing ("重新出现了") + git_log

### Attempts

#### Attempt 1 — `cca7fe27` "fix: Bug #9 flushOutbox cursor jump causes permanent message loss" (2026-03-18)
- **Proposed**: detect seq gap in `flushOutbox` and recover missed messages via `getMessagesSync.invalidate()` instead of advancing cursor past them.
- **Changed**: `packages/happy-app/sources/sync/sync.ts` — added `if (maxSeq > currentLastSeq + data.messages.length) invalidate else advance` (still present in code at lines 1612-1626).
- **Outcome**: held until at least 2026-04-25 (the commit's logic is still in HEAD). User now reports the SAME visible symptom — agent text only renders when user sends new message.
- **Failure category**: `wrong_scope` — the fix only addressed app-side `flushOutbox` (i.e. when the app SENDS a user message, the response seq doesn't jump). It did NOT address the case where the app is PASSIVELY receiving updates AND the WebSocket pushes are delayed/lost between in-turn agent text emissions.
- **Target layer**: L4 (logic — cursor/seq handling)

#### Attempt 2 — `ae29dd3e` "fix: prevent permanent message loss from flushOutbox cursor jump" (2026-03-18)
- Same path as Attempt 1 (in fact `cca7fe27` rolls in `ae29dd3e`). Same `wrong_scope` outcome for the current symptom. L4.

#### Attempt 3 — `22c5e38b` "fix(sync): detect flushOutbox seq gap and recover missed messages" (2026-03-18)
- Same family (incremental). L4.

#### Attempt 4 — `5a08be71` "fix: batch outbox flush (latest-first) and log backoff errors" (2026-03-24)
- **Proposed**: split outbox into 50-item batches; send latest-first so user "sees recent activity immediately".
- **Changed**: `packages/happy-cli/src/api/apiSession.ts:313-338` — introduced `splice(-batchSize, batchSize)` + while loop.
- **Outcome**: solved the original 400+ message blocking; **may have introduced** the current symptom because: when 60+ messages queue up during a long agent turn (multiple tool calls + text), the batch splits into "newest 50, oldest 10". This makes the seq order on the server NON-MONOTONIC against the message's logical chronological order. Then app-side `incomingSeq === currentLastSeq + 1` fast-path can succeed for a high seq while the EARLIER (chronologically older) message's seq is still pending — but app reducer sorts by `createdAt` (server stamp) which IS monotonic with seq, so the older message gets a LATER createdAt and appears at the TOP of the inverted list (rendered as "newest"). This is a candidate root cause for "doesn't refresh in real-time" (the message arrives but goes to the wrong slot in the list).
- **Failure category**: `tainted_reference` (the fix solved a different problem and accidentally degraded ordering) IF Hypothesis A (below) is correct.
- **Target layer**: L4 (logic — batching + ordering)

#### Attempt 5 — `e9ff8a9a` "fix: optimize event routing to reduce unnecessary traffic to daemons/CLI"
- Restricted `recipientFilter` for various non-message events. Did NOT touch `new-message` routing (which is `'all-interested-in-session'`). Unrelated to current symptom but informative — proves the `recipientFilter` hooks exist.

### Novelty Check

- **This attempt's layer**: L4-deep (logic + scheduling) on the **CLI flushOutbox-batching ordering** path AND/OR L4 on the **app-side handleUpdate seq-fallback** path — a different layer (the previous fixes addressed the in-flight retry path, this attempt addresses the in-flight passive-receipt path) and a different concern (correct rendering ORDER vs. zero-loss seq-tracking). Sufficiently distinct from prior attempts.
- **Differs from all priors**: yes
- **Rationale**: prior attempts all addressed the **app's own outbox** (response to a user-sent message). This regression involves the **passively-received** channel: WebSocket push of agent text emitted in-turn without a paired user message. None of the prior commits exercised this code path under contention.

### NEW: Avoid the destructive-action class

This BA spec does NOT propose a revert of any prior commit. Specifically `5a08be71` (latest-first batching) solved a real problem (400+-message blocking on resume) and reverting it would re-introduce that bug. Dev's fix MUST be additive (e.g. monotonic seq guarantee, or app-side reconciliation) — not a revert.

## Requirements (MoSCoW)

### Must Have

- **R1**: When claude emits assistant text in response to a `<task-notification>` system-reminder mid-turn (i.e. before the SDK `result` message), that text MUST appear in the `happy-app` UI within 2 seconds of it being emitted by claude-code, measured at desktop AND mobile, with no user interaction required to "kick" rendering.
- **R2**: Sequence ordering: agent messages emitted in chronological order T_1 < T_2 < … < T_n MUST appear in the rendered list in the same chronological order as the user reads them (top-to-bottom for chat, accounting for inverted FlashList).
- **R3**: Dev MUST capture runtime evidence (one of: ws frame log, server log line, happy-cli debug log) showing both the missing-push moment AND the post-fix successful-push moment, before submitting a fix. Inferred-only fix is REJECTED.
- **R4**: Fix MUST NOT regress `cca7fe27` (Bug #9 flushOutbox seq-gap detection in `sync.ts:1612-1626`), `5a08be71`'s 400+-message resume scenario, OR `<task-notification>` swallow logic at `sessionProtocolMapper.ts:855-859` (those messages must STILL be silently swallowed — not surfaced to user).

### Should Have

- **R5**: Add CLI-side debug logging (gated by `DEBUG=apiSession`) that emits `[OUTBOX] flushed batch sz=N first_seq=… last_seq=… newest_localId=…` so future regressions can be diagnosed without source-reading.
- **R6**: Add app-side debug logging (`console.log` gated by existing flag) that emits `[Sync] new-message seq=… expected=… (gap=… → invalidating)` for every `new-message` update — already partially present at `sync.ts:1832`, extend to log seq.

### Could Have

- **R7**: Server-side metric: count of `new-message` updates emitted vs. count of distinct `(sid, seq)` requested via `/v3/sessions/:id/messages` GET. Persistent gap = WebSocket transport problem.

### Won't Have (Non-Goals)

- Revert `5a08be71` (latest-first batching).
- Surface `<task-notification>` to the user as a real message bubble (it is correctly suppressed).
- Re-architect the SessionEnvelope protocol.
- Touch production happy (`/root/happy/`) — this is a happy-dev investigation.
- Restart any production daemon.

## Requirements Decomposition

| ID | Source phrase (verbatim from user) | Acceptance criterion |
|---|---|---|
| R1 | "刚刚后台任务导致 happy session 不更新的问题重新出现了。只有用户重新发消息才会收到后台任务结束了 claude 的反映（响应/输出）" | Trigger an `Agent` tool with `run_in_background: true`; subagent emits a 1-line text response and exits; orchestrator (claude) responds to the resulting `<task-notification>` with at least one assistant text block; that text appears in the happy-app UI within 2s WITHOUT the human user typing or sending anything. Verified on desktop AND mobile viewports. |
| R3 | "(正如 Spec 所说)…在恢复刚刚的工作流之前，先加一个 BA 调查本 session 出现这个情况的原因" | BA spec lists the source/measured location for every diagnostic claim AND commits dev to capturing runtime evidence before fix. |

## Setup / Environment matrix to capture during dev verification

The dev subagent MUST verify on the matrix below before declaring a fix:

| viewport | theme | reproduction path |
|---|---|---|
| Desktop 1440×900 | light | Playwright at dev.life-ai.app session, send a prompt that calls Agent run_in_background, wait |
| Mobile 390×844 | light | Same with `browser_resize(390, 844)` first |

## Acceptance Criteria

### AC1: Real-time render of post-task-notification text (desktop)

- GIVEN a happy-app session at `https://dev.life-ai.app/session/<id>` on desktop 1440×900, with no user actively typing
- AND claude is in an active turn AND has just dispatched a backgrounded subagent that finishes within 30s
- AND the subagent finishes; claude-code injects `<task-notification>`; claude emits assistant text "<some short reply>"
- WHEN waiting up to 2000ms after the timestamp the assistant text was emitted by claude-code (read from happy-cli debug log `journalctl -u happy-daemon-dev` or stdout)
- THEN the assistant text "<some short reply>" appears as a rendered message in the app's message list
- AND no manual user action (typing, sending, scrolling, refreshing) is required to make it appear
- AND screenshot `docs/dev/evidence/dev-bgtask-<ts>/desktop.png` shows the text rendered

### AC2: Real-time render of post-task-notification text (mobile)

- Same as AC1 with `browser_resize(390, 844)` BEFORE navigation
- Screenshot `docs/dev/evidence/dev-bgtask-<ts>/mobile.png`

### AC3: Chronological ordering preserved across batched flushOutbox

- GIVEN claude emits 60+ small messages within a 5s window during a single turn (text + tool-call lifecycle pairs)
- WHEN happy-cli `flushOutbox` splits into batches of 50 (newest first per current code)
- THEN the rendered order in the app — read top-to-bottom in chat order — matches the chronological emission order
- AND no message renders "above" a later one or "below" an earlier one
- Verification: pick 5 consecutive messages by their visible content (e.g. tool-call label numbers 1-5), confirm they appear in 1, 2, 3, 4, 5 reading order on screen
- Screenshot `docs/dev/evidence/dev-bgtask-<ts>/ordering.png`

### AC4: No regression on prior fixes

- AC4a: `cca7fe27` seq-gap detection still triggers when seq jumps unexpectedly during user message send (existing branch at `sync.ts:1621-1626`)
- AC4b: `5a08be71` 400+-message resume case still works — verify by scrolling to oldest message in any 200+-message session and confirming all messages eventually load
- AC4c: `<task-notification>` text NEVER appears as a user-bubble or agent-bubble in the app — verified by grepping the rendered DOM `textContent` for `<task-notification>` after AC1/AC2 (must return zero hits)

### AC5: Runtime evidence capture (R3)

- Dev subagent's report MUST include at least one of: a happy-server log excerpt showing the `new-message` emit for the assistant message, a happy-daemon-dev log excerpt showing `[SOCKET] flushed batch sz=N`, OR a Playwright Network panel screenshot showing the ws frame.
- Inferred-only fix is REJECTED — orchestrator gates dev on this.

## Edge Cases & Risks

- **CSS `<task-notification>` literal in user content**: highly unlikely a user types this; suppress only when `body.message.content.trim().startsWith('<task-notification>')` AND it's a `user`-role message — already done correctly.
- **Backgrounded subagent NEVER finishes** (long-running): not a bug; user expects no notification.
- **Two backgrounded subagents finish near-simultaneously**: claude-code injects two notifications back-to-back; claude may reply with one or two text blocks. AC1 covers both cases (any number of post-notification texts must render).
- **App in background tab on web**: AC1 explicitly tests with the tab visible. App-in-background is out of scope for this fix (separate `maybeStartBackgroundSendWatchdog` system).
- **WebSocket disconnected during background subagent**: when re-connected, `apiSocket.onReconnected` invalidates `getMessagesSync` for all sessions (`sync.ts:1755-1771`). If the regression IS WebSocket-disconnect-related, the fix must handle reconnection too (in fact this path likely already works — it's the steady-state push that fails).
- **Reducer side-effects**: `applyMessages` mutates `existingSession.reducerState` in place (`storage.ts:540`); a stale pointer won't propagate. This is a Zustand idiom not a bug, but BA flags it for awareness.
- **`<task-notification>` from JSONL replay on session resume**: scanner forwards isMeta/isSidechain only; `<task-notification>` is neither, so it's NOT replayed — good. But if this assumption breaks, suppression still triggers in `sessionProtocolMapper.ts`.

## Hypotheses for dev to discriminate (use DevTools / journalctl, not source reading)

- **H_A — App-side seq fast-path miss**: the WebSocket pushes ARE arriving, but `incomingSeq === currentLastSeq + 1` is FALSE because the latest-first batching at `apiSession.ts:313-338` causes server seq to be assigned in non-monotonic order vs. message's logical timestamp. App falls into the `else` branch at `sync.ts:1864-1865` which calls `getMessagesSync(sid).invalidate()`. That invalidation triggers a full DB refetch, which may be debounced or rate-limited (check `InvalidateSync` semantics). Net: messages wait until next invalidation cycle (which the user triggers by sending a message → `flushOutbox` → fast-path resumes).
  - Discriminator: app-side `console.log` of `currentLastSeq, incomingSeq` per `new-message`, and time-to-render. If `incomingSeq` consistently jumps and the fallback path is slow, this is the bug.
  - Layer: L4

- **H_B — App-side `getMessagesSync.invalidate()` debouncing/coalescing**: even if the fast-path fails, the fallback `invalidate()` should refetch. If `InvalidateSync` debounces invalidations during in-flight requests OR is gated by some condition (e.g. `onSessionVisible` only refetches when session is "visible" per `sync.ts:229-241`, but session IS visible), the refetch is delayed.
  - Discriminator: app-side `console.log` inside `getMessagesSync.invalidate()` and inside the resulting axios GET. Time-to-fetch should be sub-second; if not, this is the bug.
  - Layer: L4

- **H_C — Server-side WebSocket push lost between in-turn messages**: the server emits `new-message` per created message but the WebSocket transport silently drops some frames during burst. socket.io has buffering and reconnect, but transient packet loss can manifest as "some new-message updates never arrive at app". Then app's `sessionLastSeq` stays at, say, 100 while server has stored seq 101-110.
  - Discriminator: capture WebSocket frames in DevTools Network → WS during a reproduction. Count `update.body.t === 'new-message'` for the session vs. count via `GET /v3/sessions/:id/messages?after_seq=…` after the user "kick" prompt. Mismatch = transport loss.
  - Layer: L4 (transport/server) + L5 (network/infra) depending on where loss occurs.

- **H_D — happy-cli `flushOutbox` rate-limited backoff swallows errors silently**: if a POST 4xx/5xx happens, backoff retries forever and no error is surfaced. `5a08be71`'s changelog claimed to add error logging — verify the log line is actually emitted on failure.
  - Discriminator: tail `journalctl -u happy-daemon-dev` during a reproduction. If `flushOutbox` errors are silent, that's the bug source.
  - Layer: L4

Dev must rule in/out at least 2 of these 4 with runtime evidence before claiming root cause. Then fix targets the confirmed hypothesis.

## Technical Hints (for dev — NOT a fix mandate)

### Files probably involved (do NOT presume one is "the" fix without runtime evidence)

| File | Why it's a candidate |
|---|---|
| `packages/happy-app/sources/sync/sync.ts:1774-1872` | App-side WebSocket update handler; fast-path / fallback decision |
| `packages/happy-app/sources/sync/sync.ts:1612-1626` | App-side flushOutbox seq-gap (Bug #9 fix); ensure no regression |
| `packages/happy-app/sources/sync/sync.ts:1655-1730` | App-side fetchMessages full pagination |
| `packages/happy-cli/src/api/apiSession.ts:313-338` | CLI-side `flushOutbox` latest-first batching (`5a08be71`) |
| `packages/happy-cli/src/api/apiSession.ts:355-425` | CLI-side `sendClaudeSessionMessage` (mapper + legacy duplex) |
| `packages/happy-cli/src/claude/utils/OutgoingMessageQueue.ts` | 250ms-delay + `releaseToolCall` ordering |
| `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts:160-217` | Server emit `new-message` per created message |
| `packages/happy-server/sources/app/events/eventRouter.ts:230-338` | EventRouter recipient filter and connection emit |

### Verification commands (for dev)

```bash
# 1. Tail server logs during reproduction (run in parallel terminal)
docker logs -f happy-server-dev | grep -E "(new-message|update.*sid)"

# 2. Tail dev daemon during reproduction
journalctl -u happy-daemon-dev -f | grep -E "(\[SOCKET\]|flushOutbox|sendClaudeSessionMessage)"

# 3. Playwright DevTools WebSocket frame capture
#    Use mcp__playwright__browser_network_requests or open page DevTools manually
```

### App-side log instrumentation (R5/R6)

Add `console.log` at:
- `sync.ts:1851-1855` — log `currentLastSeq, incomingSeq, fastPath: <bool>`
- `sync.ts:1864-1865` — log `[Sync] fallback invalidate triggered for ${sid} seq=${incomingSeq}`
- `apiSession.ts:313` — log `[SOCKET] flushOutbox batch sz=${batch.length} pending=${this.pendingOutbox.length}`

Then rebuild dev web (`docker build -f Dockerfile.webapp --build-arg HAPPY_SERVER_URL=https://api-dev.life-ai.app -t happy-app:dev .`) and dev cli (build from worktree, use sandbox daemon) and reproduce.

### Reproduction prompt for the active dev session

Prompt to send to claude in the dev session:

> Use the Agent tool in run_in_background mode to run a quick task: "echo hello && sleep 10 && echo done". After dispatching it, continue with normal output: list 3 things you observe about this codebase. After ~15 seconds the subagent will finish; reply with "OK got it" and stop.

This forces:
1. an `Agent` tool call with `run_in_background: true`
2. subsequent assistant text (3 observations) — must render in real-time
3. a `<task-notification>` injection ~15s later
4. claude's "OK got it" reply — THIS is the message that the user reports doesn't render

If "OK got it" only appears after the human tester sends another prompt, AC1 fails and the bug is reproduced.

### Constraints

- Do NOT revert `5a08be71`, `cca7fe27`, `ae29dd3e`, `22c5e38b`. Forward-fix only.
- Do NOT modify the `<task-notification>` swallow at `sessionProtocolMapper.ts:855-859` — keep it suppressed.
- Do NOT touch production happy (`/root/happy/`).
- Do NOT restart `happy-daemon`, `happy-daemon-jade`. Only `happy-daemon-dev` (and only via `/root/bin/safe-daemon-restart.sh dev` SOP — request user permission first).
- Run `yarn typecheck` after changes.
- Rebuild dev web and dev daemon from worktree (NOT from `/root/happy`).

### Destructive-Action Escalation check

This BA spec does NOT instruct any destructive verb (`git revert`, `git reset --hard`, `git push --force`, `git branch -D`, history rewrite). All proposed changes are forward-only edits or additive logging. No user-consent block needed.

