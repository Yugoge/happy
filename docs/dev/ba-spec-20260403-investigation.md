# BA Specification: Sidechain Display Bug Root Cause Analysis

**Request ID**: dev-20260403-120000
**Created**: 2026-04-03T12:00:00Z

## Goal

Identify the root cause of why subagent/sidechain messages in new Happy sessions (created after Mar 28 compose rebuild) display as empty Agent/Task blocks (rocket icon + title only, no internal tool calls), while old sessions render correctly.

## Context

On Mar 28 ~21:00, a `docker compose up -d` recreated all containers including production happy-server. The server was down ~15 seconds. After this event, ALL new sessions show empty agent blocks. Old sessions continue to work. Both web and mobile are affected. Server data is confirmed present and correctly structured in PostgreSQL.

## Root Cause Analysis

### Symptom
Agent/Task tool blocks show rocket icon + title but no internal tool calls when expanded. Affects ALL sessions created after the compose rebuild. Both platforms affected.

### Root Cause: Dual-path sidechain linking failure in the app-side reducerTracer

The app has TWO paths for linking sidechain messages to their parent Task tool calls:

**Path A (Legacy output, `promptToTaskId`)**: Works via `type: 'sidechain'` content with a `prompt` field. The tracer matches the prompt text to a known Task tool call's prompt. This ONLY works when the legacy output path is active (not filtered by `meta.duplex`).

**Path B (Session protocol, `toolCallToMessageId`)**: Works via CUID2 subagent IDs. The Task `tool-call-start` envelope registers `toolCallToMessageId[call_CUID2] = messageId`. Sidechain children have `parentUUID = subagent_CUID2`. The tracer looks up `toolCallToMessageId.get(parentUuid)`.

**The critical issue**: For Task/Agent tool calls, the `sessionProtocolMapper.ts` uses **two different CUID2 IDs**:

1. `sessionSubagentForCall = ensureSessionSubagentIdForProviderSubagent(state, call)` -- this is a NEW CUID2 generated for the provider's tool call ID
2. The `tool-call-start` envelope has `call: sessionSubagentForCall` (the new CUID2)
3. The sidechain children have `subagent: sessionSubagentForCall` (the same new CUID2)

On the app side:
- `normalizeSessionEnvelope` for `tool-call-start`: `content.id = envelope.ev.call = sessionSubagentForCall`
- Tracer registers: `toolCallToMessageId[sessionSubagentForCall] = message.id`
- Sidechain children: `parentUUID = envelope.subagent = sessionSubagentForCall`
- Tracer lookup: `toolCallToMessageId.get(sessionSubagentForCall)` -- MATCH

**This should work.** However, the actual failure likely occurs because:

1. **The `start`/`stop` lifecycle envelopes are dropped** by `normalizeSessionEnvelope` (line 569-572), but they carry the `subagent` CUID2. If a sidechain child arrives BEFORE the `tool-call-start` (due to buffering/ordering), the tracer has no entry in `toolCallToMessageId` and the child becomes an orphan.

2. **Orphan resolution depends on `isCuid2Like` matching** (reducerTracer.ts:275). The CUID2 pattern check requires `[a-z][a-z0-9]{15,}` -- if the session protocol mapper generates IDs that don't match this pattern, orphans are released as standalone messages instead of being buffered.

3. **The `processOrphans` flush at line 185-188** only triggers when a `tool-call` content is processed. If the Task `tool-call-start` message is somehow not recognized as a `tool-call` type in the reducer's Phase 2, orphans never get flushed.

### Why old sessions work

Old sessions were processed in REAL-TIME through the reducer. Messages arrived one at a time in correct chronological order. The `tool-call-start` for Task always arrived before its sidechain children because the CLI sends them in that order. By the time sidechain children arrive, `toolCallToMessageId` already has the entry.

### Why new sessions fail

New sessions, when loaded from history (HTTP fetch), process all messages in batch. The batch ordering is by `seq` (ascending), which preserves chronological order. However, there may be a subtle issue:

1. Messages are fetched in pages of 100 (`limit=100`)
2. Each page is normalized by `normalizeRawMessage` -- this filters `meta.duplex` messages, drops `start`/`stop` lifecycle events, and returns null for various conditions
3. The remaining non-null messages go to the reducer
4. **If a `tool-call-start` is in page N and its sidechain children span pages N and N+1**, the children in page N get processed WITH the tool-call-start (tracer handles them together), but children in page N+1 get processed in a separate `reducer()` call

The tracer state persists across calls (stored in `reducerState.tracerState`), so `toolCallToMessageId` should still be available. **But there may be a page-boundary edge case where the ordering breaks.**

### Most likely specific failure

After further analysis, the most probable specific cause is: **the app's `preprocessMessageContent` function (typesRaw.ts:429-443) wraps session envelopes into `{type: 'session', data: envelope}` format, but only when `content.type !== 'session'`**. If the CLI sends session envelopes already wrapped (as `{role: 'session', content: {type: 'session', data: envelope}}`), the preprocessor does NOT double-wrap. But if there was a format change between old and new CLI binary builds, the envelope structure might differ, causing Zod validation to fail silently (returning null from `normalizeRawMessage`).

## Requirements (MoSCoW)

### Must Have
- Add debug logging to the app's `normalizeRawMessage` to count how many messages return null and why (Zod validation failure, duplex filter, start/stop filter, etc.)
- Add debug logging to `reducerTracer.traceMessages` to count orphan messages, toolCallToMessageId hits/misses, and promptToTaskId hits/misses
- Run this debug logging against a specific old working session and a new broken session to identify the exact divergence point
- Compare actual decrypted message envelope structure between old and new sessions for the Task tool-call-start and its first sidechain child

### Should Have
- Create a unit test that replays decrypted messages from a broken session through `normalizeRawMessage` + `reducer` to reproduce the bug
- Verify that `isCuid2Like` pattern matches the actual CUID2s generated by `sessionProtocolMapper`

### Could Have
- Add a metrics/telemetry endpoint to report sidechain linking success rate per session

### Won't Have (Non-Goals)
- Server-side changes (data is correct in DB)
- CLI-side changes (messages are correctly sent)
- Production web image rebuild (avoid touching `happy-app:message-fixes`)

## Edge Cases & Risks

- The `sendExisting` path in `sessionScanner.ts` does NOT read `subagents/*.jsonl` files, so resumed sessions are missing sidechain data. This is a confirmed separate bug.
- Clearing browser cache and reloading old sessions should be tested -- if old sessions break after cache clear, the bug is in state reconstruction (not data).
- The page-boundary hypothesis means the bug may be intermittent depending on where agent blocks fall relative to page boundaries.

## Acceptance Criteria

### AC1: Root cause identified with evidence
- GIVEN debug logging is added to the app reducer pipeline
- WHEN a new broken session is loaded
- THEN the logs show exactly which sidechain messages fail to link and why (orphan timeout, toolCallToMessageId miss, Zod parse failure, etc.)

### AC2: Bug is reproducible in unit test
- GIVEN decrypted messages from a broken session are captured
- WHEN replayed through `createReducer()` + `reducer()` + `traceMessages()`
- THEN the resulting `state.sidechains` map is empty for the Task tool message IDs (reproducing the bug)

### AC3: Fix verified against both old and new sessions
- GIVEN the fix is applied
- WHEN both old and new sessions are loaded from server
- THEN both display agent/Task block internals correctly

## Technical Hints

- Affected files: `packages/happy-app/sources/sync/typesRaw.ts`, `packages/happy-app/sources/sync/reducer/reducerTracer.ts`, `packages/happy-app/sources/sync/reducer/reducer.ts`
- Related patterns: The `preprocessMessageContent` function at line 429 handles envelope format normalization
- Constraints: Cannot rebuild production web image; debug must use dev web (`happy-app:dev`)
- Key test: Clear all browser storage, then open an OLD working session. If it still works, the data is truly different. If it breaks, the bug has always existed and was masked by in-memory caching.
