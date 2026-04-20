# Mapper State Lifecycle Investigation

**Source file**: `packages/happy-cli/src/claude/utils/sessionProtocolMapper.ts`  
**All line numbers reference the file as read above.**

---

## Question 1: What does clearSubagentTracking() clear?

`clearSubagentTracking()` is defined at **lines 422–432**. It clears every Map/Set on the
`ClaudeSessionProtocolState` object:

| Map/Set | Getter called | What it holds |
|---------|--------------|---------------|
| `uuidToProviderSubagent` | `getUuidToProviderSubagent(state)` | JSONL uuid → provider-subagent (tool_use_id) |
| `taskPromptToSubagents` | `getTaskPromptToSubagents(state)` | task prompt text → queued subagent CUIDs |
| `providerSubagentToSessionSubagent` | `getProviderSubagentToSessionSubagent(state)` | provider-subagent (tool_use_id) → session CUID |
| `subagentTitles` | `getSubagentTitles(state)` | session CUID → display title |
| `bufferedSubagentMessages` | `getBufferedSubagentMessages(state)` | provider-subagent → buffered message list |
| `hiddenParentToolCalls` | `getHiddenParentToolCalls(state)` | set of tool_use_ids with hidden parent call (Task tool) |
| `startedSubagents` | `getStartedSubagents(state)` | set of started session CUIDs |
| `activeSubagents` | `getActiveSubagents(state)` | set of currently active session CUIDs |
| `toolUseMap` | `getToolUseMap(state)` | tool_use_id → { name, input } |

**All 9 Maps/Sets are cleared in a single call.** `pendingSkillCommandUuid` and
`pendingSkillCommandName` are NOT cleared — they survive the turn boundary by design
(see comment at line 652–653).

---

## Question 2: When is clearSubagentTracking() called?

### Direct call site

`clearSubagentTracking()` is called **only from `closeTurn()`** at **line 456**.

```
closeTurn() [line 445–457]
  └─ clearSubagentTracking(state)  [line 456]
```

### All call sites of closeTurn()

1. **Line 654** — non-sidechain user message with `<command-message>` content (skill/slash command):
   ```
   message.type === 'user'
   && typeof message.message.content === 'string'
   && text.includes('<command-message>')
   && nameMatch found
   → closeTurn(state, 'completed', envelopes)
   ```

2. **Line 685** — non-sidechain user message with plain string content that is NOT a system-injected
   message:
   ```
   message.type === 'user'
   && typeof message.message.content === 'string'
   && !message.isSidechain
   && systemServiceText === null
   → closeTurn(state, 'completed', envelopes)
   ```

3. **Line 763** — non-sidechain user message with ARRAY content, where userTexts exist and are
   NOT a system-injected message and NOT isMeta:
   ```
   message.type === 'user'
   && Array.isArray(message.message.content)
   && !message.isSidechain
   && userTexts.length > 0
   && systemText === null
   && !isMeta
   → closeTurn(state, 'completed', envelopes)
   ```

4. **Line 484** (exported `closeClaudeTurnWithStatus()`) — called by external callers when the
   Claude process exits or errors. This is the "force close" path used by `claudeRemote.ts` /
   `apiSession.ts` on result/error.

### Does receiving a tool_result for the Agent tool trigger closeTurn()?

**Answer: NO, with one critical caveat.**

The tool_result for the Agent tool arrives as a `user` message with ARRAY content:
```json
{ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "toolu_xxx" }] } }
```

Inside the array-content branch (line 695+), the code:
1. Separates blocks into `userTexts` and `toolResultBlocks` (lines 729–735).
2. A pure tool_result message has **no text blocks**, so `userTexts.length === 0`.
3. The `closeTurn()` at line 763 is guarded by `userTexts.length > 0`.
4. The `toolResultBlocks` are handled at line 769 without calling `closeTurn()`.

**Therefore: a user message containing ONLY tool_results does NOT trigger closeTurn()
and does NOT clear subagent tracking.**

The turn remains open. Subagent mappings survive. This is the correct behavior.

However: if the user message has BOTH a text block AND tool_result blocks (which Claude
can produce), then `closeTurn()` IS called at line 763, BEFORE the tool_result blocks
are processed at line 769. The tool_result processing at 769–796 then calls
`getSessionSubagentIdForProviderSubagent(state, block.tool_use_id)` on an already-cleared
map → returns `undefined` → tool-call-end emitted with `call: block.tool_use_id` (raw
tool_use_id, not the CUID) and no subagent stop. This is a secondary edge case.

---

## Question 3: What happens when sidechain messages arrive after clearSubagentTracking()?

### Normal buffering path (mapping not yet created)

When `resolveProviderSubagent(message, state)` returns a `providerSubagent` (e.g., `"toolu_xxx"`)
but `getSessionSubagentIdForProviderSubagent(state, "toolu_xxx")` returns `undefined` (because the
tool_use_id → CUID mapping in `providerSubagentToSessionSubagent` hasn't been created yet):

- Lines 509–514: message is buffered with key `"toolu_xxx"`.
- Later, when the assistant message containing the `tool_use` block with `id: "toolu_xxx"` is
  processed (line 553), `ensureSessionSubagentIdForProviderSubagent` creates the CUID mapping,
  and lines 580–584 or 596–600 replay the buffer.

**This is the INTENDED path for sidechain messages arriving before their tool_use block.**

### Failure path: sidechain messages arrive AFTER clearSubagentTracking()

If `clearSubagentTracking()` has already been called (via `closeTurn()`), then:

1. `providerSubagentToSessionSubagent` is empty → `getSessionSubagentIdForProviderSubagent`
   returns `undefined`.
2. `bufferedSubagentMessages` is also empty (it was cleared).
3. `uuidToProviderSubagent` is empty → parentUuid inheritance chain is broken.

For a sidechain message arriving after the clear:

**Step A**: `resolveProviderSubagent(message, state)` is called (line 503).
- `pickProviderSubagent(message)` reads `parent_tool_use_id` from the sidechain message.
  - If it has an explicit `parent_tool_use_id` (e.g., `"toolu_xxx"`): returns `"toolu_xxx"`.
  - If it relies on `parentUuid` inheritance: `uuidToProviderSubagent` is empty →
    returns `undefined`.
  - If it's a sidechain root user message: tries `consumeTaskPromptSubagent` (map is empty)
    → tries `consumeSinglePendingTaskSubagent` (map is empty) → returns `undefined`.

**Step B**: If `resolveProviderSubagent` returns `"toolu_xxx"`:
- `getSessionSubagentIdForProviderSubagent(state, "toolu_xxx")` → `undefined` (map cleared).
- Lines 509–514: message is BUFFERED with key `"toolu_xxx"`.
- **The buffer is NEVER replayed** because the `tool_use` block for `"toolu_xxx"` was
  processed in a previous call and will not arrive again.

**Step C**: If `resolveProviderSubagent` returns `undefined`:
- The sidechain message is treated as a TOP-LEVEL message (no subagent context).
- It proceeds through the normal assistant/user processing without a `subagent` field.
- The `subagent` field in emitted envelopes will be `undefined`.
- The envelope is emitted but attributed to the main agent, not the subagent.

**Conclusion: YES, this is a real failure mode.** Sidechain messages arriving after a turn
close lose their subagent attribution. They either get buffered and silently dropped, or
they get emitted as top-level agent messages without a `subagent` field.

---

## Question 4: When are buffered messages replayed?

`consumeBufferedSubagentMessages(state, call)` is called at exactly two places:

1. **Line 580** — inside the `shouldHideParentToolCall(name)` branch (Task tool):
   ```
   if (shouldHideParentToolCall(name)) {
       ...
       const buffered = consumeBufferedSubagentMessages(state, call);  // line 580
       for (const bufferedMessage of buffered) { ... }
   }
   ```

2. **Line 596** — for all other subagent tools (Agent tool, and non-hidden tools):
   ```
   const buffered = consumeBufferedSubagentMessages(state, call);  // line 596
   for (const bufferedMessage of buffered) { ... }
   ```

Both calls happen **inside the `block.type === 'tool_use'` processing branch**, which runs
inside the `message.type === 'assistant'` branch (lines 531–608). Both are triggered only
when an assistant message containing the matching `tool_use` block is processed.

**This is the ONLY time buffers are consumed.** There is no secondary replay mechanism.

### The critical implication

If the `tool_use` block was processed in call N of `sendClaudeSessionMessage()`, and
`clearSubagentTracking()` is called before call N+M (the sidechain messages arrive), then:

- The buffer for `"toolu_xxx"` (created in call N) was already consumed and deleted at line
  596/580 during call N.
- When sidechain messages arrive in call N+M and get buffered again (lines 509–514), they
  are stored under key `"toolu_xxx"` in a freshly allocated `bufferedSubagentMessages` Map.
- But the `tool_use` block will never arrive again (it was in a past assistant message).
- The buffer will never be replayed.
- These sidechain messages are silently lost.

---

## Question 5: Across multiple sendClaudeSessionMessage() calls, is mapper state preserved?

### State persistence

`ClaudeSessionProtocolState` is stored on `ApiSessionClient` as `this.claudeSessionProtocolState`.
It persists across calls to `sendClaudeSessionMessage()`. There is NO per-call reset.

### Scenario trace: Agent tool sidechain messages arriving in a different call than the tool_use

**Call 1**: Claude sends assistant message with Agent tool_use
```
message.type === 'assistant'
  block.type === 'tool_use', name === 'Agent', id === 'toolu_xxx'
  → ensureSessionSubagentIdForProviderSubagent(state, 'toolu_xxx') creates CUID 'cuid_yyy'
  → queueTaskPromptSubagent(state, prompt, 'toolu_xxx')
  → consumeBufferedSubagentMessages(state, 'toolu_xxx') → [] (empty, no prior buffer)
  → emits tool-call-start with call='toolu_xxx', args.sessionSubagent='cuid_yyy'
State after: providerSubagentToSessionSubagent = { 'toolu_xxx' → 'cuid_yyy' }
```

**Call 2**: A non-sidechain user message arrives (the Agent tool prompt, sent as regular user message)

Looking at this carefully: the Agent tool result arrives as a user message with `tool_result`
blocks (array content, no text blocks). As established in Question 2, this does NOT trigger
`closeTurn()`. The turn stays open. State is preserved.

BUT: if BEFORE the tool_result arrives, the user sends an actual text message (e.g., a new
prompt to the main session), that message would be `message.type === 'user'`, string content,
`!isSidechain`, which triggers `closeTurn()` at line 685 → `clearSubagentTracking()`.

**Call 3** (after a text user message triggered closeTurn): Sidechain messages arrive
```
message.isSidechain === true
message.parent_tool_use_id === 'toolu_xxx'  (set by Claude SDK)

resolveProviderSubagent(message, state):
  pickProviderSubagent(message) → 'toolu_xxx'  (explicit)
  → returns 'toolu_xxx'

getSessionSubagentIdForProviderSubagent(state, 'toolu_xxx'):
  → providerSubagentToSessionSubagent was cleared → returns undefined

lines 509–514:
  bufferSubagentMessage(state, 'toolu_xxx', message)
  return []  ← sidechain message silently dropped (buffered but never replayed)
```

### Does the Agent tool_result trigger closeTurn()?

**Definitive answer: NO.**

The Agent tool_result message structure:
```json
{
  "type": "user",
  "isSidechain": false,
  "message": {
    "content": [{ "type": "tool_result", "tool_use_id": "toolu_xxx", "content": "..." }]
  }
}
```

This is `message.type === 'user'` with ARRAY content. The array-content branch (line 695)
separates blocks:
- `userTexts = []` (no text blocks in a pure tool_result message)
- `toolResultBlocks = [{ type: 'tool_result', ... }]`

The `closeTurn()` at line 763 requires `userTexts.length > 0`. Since `userTexts` is empty,
`closeTurn()` is NOT called.

The tool_result is processed at lines 769–796 using the current (preserved) state. If the
state was not cleared, `getSessionSubagentIdForProviderSubagent(state, 'toolu_xxx')` returns
`'cuid_yyy'`, and the Agent's subagent stop is correctly emitted.

### Turn lifecycle summary

| Event | closeTurn() called? | clearSubagentTracking() called? |
|-------|--------------------|---------------------------------|
| assistant message | No | No — `ensureTurn()` starts turn if needed |
| user string message (non-sidechain, not system) | **YES** | **YES** |
| user string message (sidechain) | No | No |
| user array message with ONLY tool_results (non-sidechain) | No | No |
| user array message with text blocks (non-sidechain) | **YES** | **YES** |
| user array message (sidechain) | No | No |
| `<command-message>` user string | **YES** | **YES** |
| `closeClaudeTurnWithStatus()` external call | **YES** | **YES** |

### The actual dangerous window

The failure mode is NOT between the Agent tool_use and the Agent tool_result. It is:

**If any non-sidechain user text message arrives AFTER the Agent tool_use is processed but
BEFORE the sidechain messages finish arriving**, `closeTurn()` fires and wipes the mapping.

In practice, this can happen when:
1. The user sends a new message to the main session while the Agent subagent is running.
2. A `<command-message>` (slash command) arrives in the main session stream.
3. Any non-system-injected plain text arrives from the main session.

After the clear, all subsequent sidechain messages from the subagent lose their `subagent`
field. They get buffered (if `parent_tool_use_id` is present) and silently dropped, or they
get emitted as top-level agent messages (if `parent_tool_use_id` is absent and no inheritance
chain is intact).

---

## Summary: Is the buffering-then-no-replay the failure mode?

**YES.** The exact failure sequence is:

1. Assistant message with Agent `tool_use id='toolu_xxx'` processed in call N.
   - `providerSubagentToSessionSubagent` maps `'toolu_xxx'` → `'cuid_yyy'`.
   - `bufferedSubagentMessages['toolu_xxx']` consumed (empty) — buffer replay point passed.

2. A non-sidechain user text message arrives (any cause).
   - `closeTurn()` → `clearSubagentTracking()` → ALL maps cleared including
     `providerSubagentToSessionSubagent` and `bufferedSubagentMessages`.

3. Sidechain messages arrive with `parent_tool_use_id: 'toolu_xxx'`.
   - `resolveProviderSubagent` → `'toolu_xxx'` (explicit).
   - `getSessionSubagentIdForProviderSubagent(state, 'toolu_xxx')` → `undefined` (cleared).
   - `bufferSubagentMessage(state, 'toolu_xxx', message)` — buffered.
   - Return empty envelopes.
   - **Buffer will never be replayed** (no future tool_use block for `'toolu_xxx'`).

4. Agent `tool_result` arrives.
   - Does NOT call `closeTurn()`.
   - `getSessionSubagentIdForProviderSubagent(state, 'toolu_xxx')` → `undefined`.
   - `getHiddenParentToolCalls(state).has('toolu_xxx')` → false (cleared).
   - Falls to line 790: emits `tool-call-end` with `call: 'toolu_xxx'` (raw id, no CUID).
   - No subagent stop is emitted.

**Result**: Sidechain messages between step 2 and step 3 are silently dropped. The app
renders no subagent output. The `subagent` field is absent from all those envelopes.

---

## Files referenced

- `/dev/shm/dev-workspace/happy-dev/packages/happy-cli/src/claude/utils/sessionProtocolMapper.ts`
  - `clearSubagentTracking`: lines 422–432
  - `closeTurn`: lines 445–457
  - `closeTurn` call site (command-message): line 654
  - `closeTurn` call site (plain string user message): line 685
  - `closeTurn` call site (array user message with text): line 763
  - `closeClaudeTurnWithStatus` (external): lines 479–489
  - buffer path: lines 509–514
  - buffer replay (hidden/Task tool): lines 580–584
  - buffer replay (Agent/other tool): lines 596–600
  - tool_result handling (non-sidechain, array content): lines 769–796
