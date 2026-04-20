# Resume/Scanner Mapper State Trace

**Date**: 2026-04-18
**Scope**: Four questions about mapper state sharing and `clearSubagentTracking()` timing

---

## Question 1: Does resume/scanner reuse the same mapper state?

**ANSWER: YES — resume, scanner, and live paths all share the exact same `claudeSessionProtocolState` object.**

### Evidence

`apiSession.ts:89-99` — `claudeSessionProtocolState` is a **class field** of `ApiSessionClient`, initialized inline in the class body:

```typescript
private claudeSessionProtocolState: ClaudeSessionProtocolState = {
    currentTurnId: null,
    uuidToProviderSubagent: new Map<string, string>(),
    taskPromptToSubagents: new Map<string, string[]>(),
    providerSubagentToSessionSubagent: new Map<string, string>(),
    subagentTitles: new Map<string, string>(),
    bufferedSubagentMessages: new Map<string, RawJSONLines[]>(),
    hiddenParentToolCalls: new Set<string>(),
    startedSubagents: new Set<string>(),
    activeSubagents: new Set<string>(),
};
```

`apiSession.ts:355-357` — `sendClaudeSessionMessage()` passes `this.claudeSessionProtocolState` by reference:

```typescript
sendClaudeSessionMessage(body: RawJSONLines) {
    const mapped = mapClaudeLogMessageToSessionEnvelopes(body, this.claudeSessionProtocolState);
    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
```

Every caller that goes through `session.client.sendClaudeSessionMessage()` mutates the same object.

**Three call sites all route to `session.client.sendClaudeSessionMessage()`:**

1. **Resume path** — `claudeRemoteLauncher.ts:80`:
   ```typescript
   onMessage: (m) => { if (m.type !== 'summary' && !(m as any).isMeta) {
       session.client.sendClaudeSessionMessage(m);
   } }
   ```

2. **Meta/sidechain scanner path** — `claudeRemoteLauncher.ts:207-212` (`handleScannerMessage`):
   ```typescript
   function handleScannerMessage(message: RawJSONLines, session: Session, state: LauncherState) {
       if ((message as any).isMeta === true) { session.client.sendClaudeSessionMessage(message); }
       const uuid = (message as any).uuid;
       if ((message as any).isSidechain === true && typeof uuid === 'string' && !state.sentSidechainUuids.has(uuid)) {
           state.sentSidechainUuids.add(uuid);
           session.client.sendClaudeSessionMessage(message);
       }
   }
   ```

3. **Live path** — `claudeRemoteLauncher.ts:241-243` (`initServices`), via `OutgoingMessageQueue`:
   ```typescript
   const messageQueue = new OutgoingMessageQueue((log) => session.client.sendClaudeSessionMessage(log));
   ```
   And `cleanupAfterLaunch` (line 179): `session.client.sendClaudeSessionMessage(c)` for interrupted tool results.

**Conclusion**: One `ApiSessionClient` instance, one `claudeSessionProtocolState` object, three call paths all writing into it. There is no reset of the state object between resume and live phases.

---

## Question 2: What is the message order during resume scanning?

**ANSWER: Sidechain messages are NOT present in the main JSONL file. They live in separate subagent JSONL files. The resume scanner only reads the main session JSONL.**

### Evidence

`sessionScanner.ts:211-222` — `readSessionLog` reads only one file: `${sessionId}.jsonl`:

```typescript
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    // ...
    return file.split('\n').map(parseLine).filter((m): m is RawJSONLines => m !== null);
}
```

No subagent directory (`<sessionId>/subagents/`) is ever read by the scanner. The scanner has no code that descends into subdirectories.

`sessionScanner.ts:163-186` — `createSessionScanner` parameters only accept a single `sessionId`, and `initExistingMessages` + `processSession` both call `readSessionLog(projectDir, sessionId)` — i.e., the flat `.jsonl` file only.

**Main JSONL message sequence during a completed Agent/Task turn:**

```
user message (string prompt)             → non-sidechain, has text → closeTurn + user envelope
assistant message (tool_use: Agent)      → ensureTurn, emits tool-call-start, creates CUID mapping
user message (tool_result for Agent)     → ensureTurn, emits tool-call-end
```

The sidechain messages (assistant + user messages with `isSidechain: true` in `<sessionId>/subagents/agent-<agentId>.jsonl`) are **not** in the main file. Therefore the resume scanner:

1. Processes assistant message with `Agent tool_use` → calls `ensureSessionSubagentIdForProviderSubagent(state, call)` → creates CUID mapping in `providerSubagentToSessionSubagent`, queues prompt in `taskPromptToSubagents`.
2. Processes tool_result → emits `tool-call-end` using the CUID — **no sidechain messages ever arrive between these two steps**.
3. Eventually `closeClaudeTurnWithStatus('completed')` is called (see Q3) → `clearSubagentTracking()` clears everything.

So the mapper gets: assistant(Agent) → tool_result(Agent). The CUID mapping is created, used immediately for tool-call-end, then cleared. Sidechain messages that were buffered in separate files never enter this path.

---

## Question 3: When does `closeClaudeTurnWithStatus()` fire relative to resume scanning?

**ANSWER: `closeClaudeTurnWithStatus` fires AFTER resume scanning completes — specifically in `buildOnReady` when the first Claude process reaches the ready state. It does NOT fire during resume scanning itself.**

### Evidence

**The `closeClaudeSessionTurn()` → `closeClaudeTurnWithStatus()` call chain:**

`apiSession.ts:427-432`:
```typescript
closeClaudeSessionTurn(status: SessionTurnEndStatus = 'completed') {
    const mapped = closeClaudeTurnWithStatus(this.claudeSessionProtocolState, status);
    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
    for (const envelope of mapped.envelopes) {
        this.sendSessionProtocolMessage(envelope);
    }
}
```

`sessionProtocolMapper.ts:479-489` — `closeClaudeTurnWithStatus` calls `closeTurn` which calls `clearSubagentTracking`:
```typescript
function closeTurn(state, status, envelopes): void {
    if (!state.currentTurnId) { return; }
    envelopes.push(createEnvelope('agent', { t: 'turn-end', status }, { turn: state.currentTurnId }));
    state.currentTurnId = null;
    clearSubagentTracking(state);    // <-- all maps/sets cleared here
}
```

**Call sites for `closeClaudeSessionTurn` / `closeClaudeTurnWithStatus`:**

`claudeRemoteLauncher.ts:234-238` — `buildOnReady` (fires when Claude SDK signals the session is ready/idle):
```typescript
function buildOnReady(session: Session, loop: LoopState) {
    return () => {
        session.client.closeClaudeSessionTurn('completed');
        // ...
    };
}
```

`claudeRemoteLauncher.ts:271-275` — `handleNormalExit` (fires when ctrl.signal.aborted):
```typescript
if (!state.exitReason && ctrl.signal.aborted) {
    session.client.closeClaudeSessionTurn('cancelled');
```

`claudeRemoteLauncher.ts:286-287` — `handleCrash`:
```typescript
session.client.closeClaudeSessionTurn('failed');
```

**Resume timing** — `claudeRemoteLauncher.ts:340-344`:
```typescript
await uploadResumeHistory(session);                   // (1) resume scanning — synchronous, completes before loop
const onMessage = buildOnMessage(state, session, buf, svc);
const loop: LoopState = { ... };
while (!state.exitReason) {
    await runSingleLaunch(...);                        // (2) Claude process starts → onReady fires → closeClaudeSessionTurn
}
```

`uploadResumeHistory` is `await`-ed to completion at line 340. The `while (!state.exitReason)` loop starts at line 344. `closeClaudeSessionTurn` only fires inside `runSingleLaunch` (via `onReady`, `handleNormalExit`, or `handleCrash`).

**Timeline:**
```
1. uploadResumeHistory() — resume scanner reads main JSONL, sends messages → mapper state accumulates
2. [resume scanning done — await returns]
3. runSingleLaunch() — Claude SDK starts
4. Claude processes first message (from queue)
5. Claude emits 'ready' event → buildOnReady() → closeClaudeSessionTurn('completed')
   → closeTurn() → clearSubagentTracking()    ← FIRST clear after resume
6. OR: Claude crashes → handleCrash() → closeClaudeSessionTurn('failed')
```

**Important nuance**: `closeTurn` is also called **inline** by the mapper itself (not via `closeClaudeSessionTurn`) when a non-sidechain user text message arrives:

`sessionProtocolMapper.ts:685`:
```typescript
closeTurn(state, 'completed', envelopes);
envelopes.push(createEnvelope('user', { t: 'text', text }));
```

And `sessionProtocolMapper.ts:763`:
```typescript
closeTurn(state, 'completed', envelopes);
envelopes.push(createEnvelope('user', { t: 'text', text: joined }));
```

This means during resume scanning, each non-sidechain user text message in the JSONL causes `closeTurn` → `clearSubagentTracking()` inline. So mapper state is cleared on every user turn boundary **during resume replay** as well.

---

## Question 4: Can buffered sidechain messages ever be replayed in the resume path?

**ANSWER: NO. It is structurally impossible in the current code.**

### Evidence

The buffer replay mechanism in `sessionProtocolMapper.ts:580-585` works as follows:

```typescript
// When assistant message with Agent/Task tool_use is processed:
const buffered = consumeBufferedSubagentMessages(state, call);
for (const bufferedMessage of buffered) {
    const replay = mapClaudeLogMessageToSessionEnvelopesInternal(bufferedMessage, state);
    envelopes.push(...replay.envelopes);
}
```

For buffered messages to replay, they must have been added via `bufferSubagentMessage()` earlier:

`sessionProtocolMapper.ts:509-515`:
```typescript
if (providerSubagent && !subagent) {
    bufferSubagentMessage(state, providerSubagent, message);
    return { currentTurnId: state.currentTurnId, envelopes: [] };
}
```

A message is buffered when it has a `providerSubagent` (via `parent_tool_use_id`) but the corresponding `providerSubagentToSessionSubagent` mapping does not yet exist. This is the "sidechain arrives before assistant tool_use" race condition.

**Why this can never happen during resume:**

1. The resume scanner reads only `<sessionId>.jsonl` — sidechain messages are in `<sessionId>/subagents/agent-<agentId>.jsonl` (separate files, never read by the scanner).
2. Even the meta-scanner (`buildOnSessionFound`) only watches session JSONL files, not subagent files.
3. Therefore, no sidechain messages ever arrive through the resume path to be buffered.
4. The buffer is always empty after resume scanning. There is nothing to replay.

**Additional structural barriers:**

- By the time the meta-scanner starts (inside `buildOnSessionFound`, called on the first `onSessionFound` event from the live Claude SDK), `uploadResumeHistory` has already completed. The mapper state from resume is now "in the past" and may already have been partially cleared by inline `closeTurn()` calls.
- Even if subagent JSONL files were somehow read, the ordering problem remains: the mapper state (CUID mappings) populated during resume replay is cleared by `clearSubagentTracking()` when `closeClaudeTurnWithStatus` fires after the first `onReady`. Any sidechain messages arriving after that point would find an empty state.

---

## BONUS: Does `closeTurn()` fire between live steps 1-3?

**ANSWER: No, for steps 1→3 in the normal single-user-turn flow. But YES if the user sends a message while the subagent is running.**

### Evidence

**Step 1: Assistant message with Agent tool_use**

`sessionProtocolMapper.ts:531-608` — the `message.type === 'assistant'` branch calls `ensureTurn()` but never `closeTurn()`. It only emits tool-call-start and replays buffered messages. No `closeTurn`.

**Step 2: Sidechain messages**

Sidechain user messages with string content — `sessionProtocolMapper.ts:680-686`:
```typescript
if (message.isSidechain) {
    const turnId = ensureTurn(state, envelopes);
    maybeEmitSubagentStart(state, turnId, subagent, envelopes);
    envelopes.push(createEnvelope('agent', { t: 'text', text }, { turn: turnId, subagent }));
} else {
    closeTurn(state, 'completed', envelopes);  // ← only non-sidechain reaches this
    envelopes.push(createEnvelope('user', { t: 'text', text }));
}
```

Sidechain user messages with array content — `sessionProtocolMapper.ts:798-833` — handled in the `else { // Sidechain user messages }` block: calls `ensureTurn` and emits, never `closeTurn`.

Sidechain assistant messages — handled in the `message.type === 'assistant'` branch: `ensureTurn` only.

So **for sidechain messages, `closeTurn` is never called**.

**Step 3: tool_result for Agent (user message with array content, no text)**

`sessionProtocolMapper.ts:725-736`:
```typescript
const userTexts: string[] = [];
const toolResultBlocks: typeof blocks = [];
for (const block of blocks) {
    if (block.type === 'text' && ...) { userTexts.push(block.text); }
    else if (block.type === 'tool_result') { toolResultBlocks.push(block); }
}
```

If the agent tool_result message has **no text blocks** (only `tool_result` blocks), `userTexts.length === 0`, so the code falls through to the `toolResultBlocks` handling without calling `closeTurn`. The mapper state (CUID mappings) is intact at step 3. Tool-call-end is emitted correctly.

**The dangerous case: user sends message during subagent execution**

If the user sends a plain text message (string content, not sidechain) **while a subagent is running**, the mapper receives a non-sidechain user message with string content. This hits:

`sessionProtocolMapper.ts:685-686`:
```typescript
closeTurn(state, 'completed', envelopes);
envelopes.push(createEnvelope('user', { t: 'text', text }));
```

This calls `clearSubagentTracking()`, clearing all CUID mappings. Any subsequent sidechain messages or tool_results for that subagent will arrive with no mappings to look up — they will be buffered (if before tool_use) or dropped/misrouted (if after).

However, in the current implementation, the live SDK stream is sequential (Claude processes one message at a time), so the user cannot send a new message while a tool call is in mid-flight in the normal flow. The `nextMessage` function in `buildNextMessage` gates on the queue, and a new user message would only be dequeued after `onReady` fires. By that time, `buildOnReady` → `closeClaudeSessionTurn('completed')` → `clearSubagentTracking()` has already been called.

---

## Summary Table

| Path | Uses `session.client.sendClaudeSessionMessage`? | Shares mapper state? |
|------|--------------------------------------------------|----------------------|
| `uploadResumeHistory` (resume) | Yes (line 80) | Yes — same `claudeSessionProtocolState` |
| `handleScannerMessage` (meta/sidechain scanner) | Yes (lines 207, 211) | Yes — same object |
| `OutgoingMessageQueue` send function (live) | Yes (line 243, via queue) | Yes — same object |
| `cleanupAfterLaunch` interrupted tool results | Yes (line 179) | Yes — same object |

| Event | Does `clearSubagentTracking()` fire? | When |
|-------|--------------------------------------|------|
| Non-sidechain user text message in mapper | Yes (inline `closeTurn`) | During message processing |
| `onReady` callback | Yes (via `closeClaudeSessionTurn`) | After Claude turn completes |
| `handleNormalExit` (aborted) | Yes (via `closeClaudeSessionTurn`) | After Claude exits with abort |
| `handleCrash` | Yes (via `closeClaudeSessionTurn`) | After Claude crashes |
| During `uploadResumeHistory` scanning | Yes (per-turn via inline `closeTurn`) | Each user turn boundary in JSONL |

| Path | Can buffered sidechain messages replay? | Why |
|------|-----------------------------------------|-----|
| Resume path | No | Subagent JSONL files never read |
| Meta-scanner path | Theoretically yes (live) | Only reads main session JSONL; subagent files not scanned |
| Live path | Yes (designed path) | `parent_tool_use_id` arrives before `tool_use` → buffer → replay on `tool_use` |
