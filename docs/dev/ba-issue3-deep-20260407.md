# Deep Analysis: Issue 3 -- Subagent Sidebar Missing Messages

**Date**: 2026-04-07
**Scope**: 4 unresolved questions about the Task tool duplicate message theory

---

## Question 1: Does Phase 2 creating message B mean the UI renders BOTH A and B, or does B replace A?

### Code Read

**Phase 0** (reducer.ts:425-458): When `agentState.requests` contains a pending permission for `permId`, and `state.toolIdToMessageId` does NOT already have that `permId`, Phase 0 creates message A:
```
mid = allocateId();
state.messages.set(mid, { id: mid, realID: null, role: 'agent', ... tool: { name: request.tool, state: 'running', permission: { id: permId, status: 'pending' } } });
state.toolIdToMessageId.set(permId, mid);
```

**Phase 2** (reducer.ts:722-823): For each `tool-call` content block with `c.id`, it does:
```
const existingMessageId = state.toolIdToMessageId.get(c.id);
```

**Critical**: If `c.id` matches `permId`, Phase 2 finds message A and UPDATES it (line 726-754). It does NOT create a new message B. It merges input, sets `startedAt`, changes state from `completed` to `running`.

**But for Task tools**, `c.id` is the CUID2 (not the `toolu_*` ID). See sessionProtocolMapper.ts:565-578:
```
if (shouldHideParentToolCall(name)) {   // true for Task
    envelopes.push(createEnvelope('agent', {
        t: 'tool-call-start',
        call: sessionSubagentForCall,   // <-- CUID2, NOT toolu_*
        ...
    }));
}
```

Then in typesRaw.ts:644-661, the envelope is normalized to:
```
content: [{ type: 'tool-call', id: envelope.ev.call, ... }]   // id = CUID2
```

So when Phase 2 processes a Task tool-call, `c.id` = CUID2. The permission request ID in Phase 0 is the `toolu_*` ID (set by `permissionHandler.ts:195` via `resolveToolCallId` which returns `block.id` from the SDK assistant message). These are DIFFERENT strings.

Therefore: `state.toolIdToMessageId.get(CUID2)` returns undefined, and Phase 2 enters the `else` branch (line 756) and creates a NEW message B.

### Verdict: YES -- both A and B exist in `state.messages`

Phase 0 creates message A keyed by `toolu_*` ID. Phase 2 creates message B keyed by CUID2. Both are in `state.messages`. There is NO deduplication or filtering phase that removes either. Both are rendered.

**However**: Message A (from Phase 0, with `toolu_*` key) has `tool.name = 'Task'` from the permission request. Message B (from Phase 2, with CUID2 key) also has `tool.name = 'Task'`. The user potentially sees TWO Task tool entries in the message list.

Message B gets the `sessionSubagent` field in its `args` (sessionProtocolMapper.ts:561-562). Subagent child messages carry the CUID2 as their `subagent` field in the envelope metadata, which becomes their sidechain parent. So children attach to B's CUID2.

Message A (keyed by `toolu_*`) has no children because no subagent messages reference the `toolu_*` ID.

---

## Question 2: Does Task tool actually go through the permission flow?

### Code Read

**permissionHandler.ts:150-203** (`handleToolCall`):
1. `alwaysRequiresApproval` (line 153): Only `ExitPlanMode` and `AskUserQuestion`. Task/Agent are NOT in this list.
2. Tool allowlist check (line 156-173): If `this.allowedTools.has('Task')`, returns `{ behavior: 'allow' }` immediately -- NO permission request created, NO entry in `agentState.requests`.
3. `bypassPermissions` mode (line 183-185): Returns `{ behavior: 'allow' }` immediately.
4. `acceptEdits` mode (line 187-189): Only applies to `descriptor.edit` tools. `getToolDescriptor('Task')` returns `{ edit: false, exitPlan: false }`. So Task is NOT auto-approved by acceptEdits.
5. If none of the above match, falls through to full permission flow (line 195-203).

**Key finding**: In `bypassPermissions` mode (which is the default for daemon sessions via `IS_SANDBOX=1`), Task IS auto-approved without creating a permission request. In this case, Phase 0 has NOTHING for the Task tool, and only Phase 2 creates a message.

**runClaude.ts:111-115**:
```
const dangerouslySkipPermissions =
    initialPermissionMode === 'bypassPermissions' ||
    initialPermissionMode === 'yolo' ||
    sandboxEnabled ||
    Boolean(options.claudeArgs?.includes('--dangerously-skip-permissions'));
```

When `IS_SANDBOX=1` (all daemon sessions), `sandboxEnabled = true` and `dangerouslySkipPermissions = true`. This means the SDK itself skips permission checks entirely -- `canCallTool` is never called for Task.

### Phase 0 filtering

Phase 0 (reducer.ts:403-470) iterates `agentState.requests` -- there is NO filtering by tool name. ALL pending requests create messages. But if Task is auto-approved (no request created), there's nothing for Phase 0 to process.

### Verdict: DEPENDS on permission mode

- **`bypassPermissions` / sandbox mode (daemon sessions)**: Task is auto-approved. NO permission request is created. Phase 0 creates NO message A. Only Phase 2 creates message B (with CUID2). **No duplicate**. But children still attach to CUID2, which is correct since B uses CUID2 as key.
- **`default` mode (user-interactive sessions with permission prompts)**: Task goes through full permission flow. Phase 0 creates message A (keyed by `toolu_*`). Phase 2 creates message B (keyed by CUID2). **Duplicate exists**. Children attach to B (CUID2), A is orphaned.
- **`acceptEdits` mode**: Task is NOT an edit tool, so same as `default` -- full permission flow, duplicate exists.

---

## Question 3: What is the exact relationship between CUID2 sessionSubagent ID and the original toolu_* ID?

### Code Read

**sessionProtocolMapper.ts:121-133** (`ensureSessionSubagentIdForProviderSubagent`):
```
function ensureSessionSubagentIdForProviderSubagent(
    state: ClaudeSessionProtocolState,
    providerSubagent: string,        // <-- this is the toolu_* ID
): string {
    const existing = getSessionSubagentIdForProviderSubagent(state, providerSubagent);
    if (existing) return existing;
    const created = createId();       // CUID2
    getProviderSubagentToSessionSubagent(state).set(providerSubagent, created);
    return created;
}
```

**Line 548**: `const call = typeof block.id === 'string' && block.id.length > 0 ? block.id : createId();`
The `call` variable holds the original `toolu_*` ID from the SDK.

**Line 553**: `const sessionSubagentForCall = ensureSessionSubagentIdForProviderSubagent(state, call);`
Maps `toolu_*` -> CUID2. Stored in `state.providerSubagentToSessionSubagent` (a Map).

### Is the mapping available to the app?

**NO**. The mapping is stored only in `ClaudeSessionProtocolState` inside the CLI process. It is never serialized into the envelope. The envelope only contains the CUID2 (as `call` for hidden parent tools, or in `args.sessionSubagent`).

### Is the original toolu_* ID available anywhere in the envelope?

**For Task tools (shouldHideParentToolCall = true)**: The emitted envelope (line 571-578) has:
- `call: sessionSubagentForCall` (CUID2)
- `args: { ...baseArgs, sessionSubagent: sessionSubagentForCall }` (CUID2 in args too)
- `name: 'Task'`
- `title: ...`

The original `toolu_*` ID is NOT in the envelope. It is hidden. The `call` field IS the CUID2.

**For Agent tools (shouldHideParentToolCall = false)**: The emitted envelope (line 588-595) has:
- `call: call` (the original `toolu_*` ID)
- `args: { ...baseArgs, sessionSubagent: sessionSubagentForCall }` (CUID2 in args)

So for Agent, the `toolu_*` ID IS available as `call`, and the CUID2 is in `args.sessionSubagent`.

### Verdict: NO reverse lookup possible for Task; YES for Agent

- **Task**: Envelope `call` = CUID2. Original `toolu_*` is lost. No way for the app to map CUID2 back to `toolu_*`.
- **Agent**: Envelope `call` = `toolu_*`. CUID2 is in `args.sessionSubagent`. Both are available.

This is the ROOT CAUSE of the problem for Task in non-sandbox mode: Phase 0 creates message A keyed by `toolu_*`, Phase 2 creates message B keyed by CUID2, and there's no way to connect them because the `toolu_*` ID is not present in the Task envelope.

---

## Question 4: What does the tool-call-start envelope for a Task tool actually look like?

### Code Read

**sessionProtocolMapper.ts:565-586** (the Task/hidden parent path):

```typescript
if (shouldHideParentToolCall(name)) {     // true only for 'Task'
    getHiddenParentToolCalls(state).add(call);   // call = toolu_*

    envelopes.push(createEnvelope('agent', {
        t: 'tool-call-start',
        call: sessionSubagentForCall,      // CUID2 (e.g., "cm...")
        name,                              // 'Task'
        title,                             // from toolTitle() -- uses input.description or "Task call"
        description: title,                // same as title
        args,                              // { ...baseArgs, sessionSubagent: sessionSubagentForCall }
    }, { turn: turnId, subagent }));
}
```

**What is `args`?** (line 561-563):
```typescript
const args = isSubagentTool(name)
    ? { ...baseArgs, sessionSubagent: sessionSubagentForCall }
    : baseArgs;
```

Where `baseArgs = toToolArgs(block.input)` (line 469-477):
```typescript
function toToolArgs(input: unknown): Record<string, unknown> {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        return input as Record<string, unknown>;
    }
    return {};
}
```

So for a Task tool_use block with `input: { prompt: "...", description: "..." }`, the args would be:
```json
{
    "prompt": "Search for README files",
    "description": "Searching codebase",
    "sessionSubagent": "cm..."
}
```

### Key fields in the envelope:

| Field | Value | Source |
|-------|-------|--------|
| `t` | `'tool-call-start'` | literal |
| `call` | CUID2 (e.g., `"cmXXXXX"`) | `ensureSessionSubagentIdForProviderSubagent` |
| `name` | `'Task'` | `block.name` |
| `title` | `block.input.description` or `"Task call"` | `toolTitle()` |
| `description` | same as title | copied |
| `args.prompt` | from `block.input.prompt` | SDK tool_use input |
| `args.description` | from `block.input.description` | SDK tool_use input |
| `args.sessionSubagent` | same CUID2 as `call` | added by mapper |

### Does args contain sessionSubagent?

**YES**. Line 562: `{ ...baseArgs, sessionSubagent: sessionSubagentForCall }`. The CUID2 is redundantly present in both `call` and `args.sessionSubagent`.

### Is the original toolu_* ID anywhere in args?

**NO**. `toToolArgs` only passes through `block.input` (the SDK's tool input fields: `prompt`, `description`, etc.). The `block.id` (toolu_*) is not included in args.

### Verdict: The envelope has CUID2 everywhere, toolu_* nowhere

The Task tool-call-start envelope contains:
- `call` = CUID2
- `args.sessionSubagent` = CUID2 (redundant)
- `args.prompt`, `args.description` = from SDK input
- Original `toolu_*` ID is NOT present in any field

---

## Summary of Findings

| Question | Answer |
|----------|--------|
| Q1: Does Phase 2 add B alongside A? | **YES** -- both A (toolu_* key) and B (CUID2 key) coexist in state.messages |
| Q2: Does Task go through permission? | **DEPENDS** -- sandbox/bypassPermissions: NO (no duplicate). default/acceptEdits: YES (duplicate) |
| Q3: Is toolu_* -> CUID2 mapping available to app? | **NO** for Task (toolu_* lost). **YES** for Agent (both in envelope) |
| Q4: What does Task envelope look like? | `call=CUID2, args={prompt, description, sessionSubagent=CUID2}`. No toolu_* anywhere |

## Root Cause Confirmation

The duplicate message bug ONLY manifests when Task tools go through the permission flow (non-sandbox/non-bypassPermissions mode). In this case:

1. Permission handler creates `agentState.requests[toolu_*]` with `tool: 'Task'`
2. Phase 0 creates message A keyed by `toolu_*`
3. sessionProtocolMapper emits tool-call-start with `call=CUID2` (not `toolu_*`)
4. Phase 2 cannot find `toolu_*` in `toolIdToMessageId` for the CUID2 lookup, creates message B
5. Subagent child messages reference CUID2, so they attach to B
6. Message A is orphaned (shows as empty Task with pending permission, no children)

**For daemon sessions running with IS_SANDBOX=1**: This bug does NOT occur because Task is auto-approved without creating permission requests, so Phase 0 has nothing to process.

**The bug would appear in**: User-interactive sessions running in `default` permission mode where Task tools require explicit approval.
