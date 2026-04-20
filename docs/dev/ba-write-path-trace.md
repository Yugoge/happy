# Write-Path Trace: `isSidechain` for Historical Messages

**Traced**: 2026-04-18  
**Files read**: `packages/happy-cli/src/api/apiSession.ts`, `packages/happy-cli/src/claude/utils/sdkToLogConverter.ts`, `packages/happy-app/sources/sync/typesRaw.ts`, `packages/happy-app/sources/sync/sync.ts`

---

## Question 1: Does `body.isSidechain` exist at `sendClaudeSessionMessage` entry?

**File**: `packages/happy-cli/src/claude/utils/sdkToLogConverter.ts:85-105`

```typescript
convert(sdkMessage: SDKMessage): RawJSONLines | null {
    const uuid = randomUUID()
    const timestamp = new Date().toISOString()
    let parentUuid = this.lastUuid;
    let isSidechain = false;
    if (sdkMessage.parent_tool_use_id) {
        isSidechain = true;
        parentUuid = this.sidechainLastUUID.get((sdkMessage as any).parent_tool_use_id) ?? null;
        this.sidechainLastUUID.set((sdkMessage as any).parent_tool_use_id!, uuid);
    }
    const baseFields = {
        parentUuid: parentUuid,
        isSidechain: isSidechain,     // <-- set here
        ...
    }
```

**Answer: YES.**

`sdkToLogConverter.convert()` sets `isSidechain: true` in `baseFields` when `sdkMessage.parent_tool_use_id` exists. This is spread into the returned `logMessage` (the `RawJSONLines` object). By the time `sendClaudeSessionMessage(body)` is called, `body.isSidechain === true` for sidechain messages.

---

## Question 2: What exactly gets stored in the database?

**File**: `packages/happy-cli/src/api/apiSession.ts`

There are TWO separate write paths in `sendClaudeSessionMessage`:

### Path A — Session Protocol Envelope (primary)

```typescript
// apiSession.ts:355-360
sendClaudeSessionMessage(body: RawJSONLines) {
    const mapped = mapClaudeLogMessageToSessionEnvelopes(body, this.claudeSessionProtocolState);
    ...
    for (const envelope of mapped.envelopes) {
        this.sendSessionProtocolMessage(envelope);
        ...
    }
```

```typescript
// apiSession.ts:461-473
sendSessionProtocolMessage(envelope: SessionEnvelope) {
    if (envelope.role !== 'user') {
        this.enqueueSessionProtocolEnvelope(envelope);
        return;
    }
    ...
    this.enqueueSessionProtocolEnvelope(envelope);
}
```

```typescript
// apiSession.ts:449-458
private enqueueSessionProtocolEnvelope(envelope: SessionEnvelope, invalidate: boolean = true) {
    const content = {
        role: 'session',           // <-- role is 'session'
        content: envelope,         // <-- envelope stored directly (NOT wrapped in {type:'session', data:...})
        meta: {
            sentFrom: 'cli'
        }
    };
    this.enqueueMessage(content, invalidate);
}
```

**Stored shape for session protocol**:
```json
{
  "role": "session",
  "content": { "id": "...", "role": "agent", "turn": "...", "subagent": "<cuid>", "ev": {...} },
  "meta": { "sentFrom": "cli" }
}
```

The `subagent` field on the envelope is what carries the sidechain parent reference. Whether `subagent` is populated depends on `mapClaudeLogMessageToSessionEnvelopes`.

### Path B — Legacy Output (backward compat)

```typescript
// apiSession.ts:389-401
if (!isSwallowedByMapper && (body.type === 'assistant' || body.type === 'user')) {
    const legacyContent = {
        role: 'agent',
        content: {
            type: 'output',
            data: body             // <-- body includes isSidechain: true
        },
        meta: {
            sentFrom: 'cli',
            duplex: true           // <-- marked duplex
        }
    };
    this.enqueueMessage(legacyContent);
}
```

**Stored shape for legacy output**:
```json
{
  "role": "agent",
  "content": { "type": "output", "data": { "isSidechain": true, "parentUuid": "...", ... } },
  "meta": { "sentFrom": "cli", "duplex": true }
}
```

**Both are stored.** Path B carries `isSidechain` directly in `data`. Path A carries it implicitly via `envelope.subagent`.

---

## Question 3 / 4: On historical load — format mismatch analysis

### Reading path (sync.ts:1712)

```typescript
const normalized = normalizeRawMessage(decrypted.id, decrypted.localId, decrypted.createdAt, decrypted.content);
```

`decrypted.content` is the raw stored JSON object.

### `normalizeRawMessage` routing (typesRaw.ts:724-758)

```typescript
export function normalizeRawMessage(..., raw: RawRecord): NormalizedMessage | null {
    // Skip duplex messages — new clients use session protocol version
    if ((raw as any).meta?.duplex) {
        return null;   // <-- Path B (legacy output) is SKIPPED here
    }

    let parsed = rawRecordSchema.safeParse(raw);
    ...
    if (raw.role === 'session') {
        return normalizeSessionEnvelope(
            raw.content.data,   // <-- expects content.data to be the envelope
            ...
        );
    }
```

### THE FORMAT MISMATCH (Critical Finding)

**Written** (`enqueueSessionProtocolEnvelope`, apiSession.ts:449-458):
```json
{
  "role": "session",
  "content": <envelope object directly>
}
```
i.e., `content` IS the envelope itself.

**Expected by reader** (`rawRecordSchema`, typesRaw.ts:453-460):
```typescript
z.object({
    role: z.literal('session'),
    content: z.object({
        type: z.literal('session'),
        data: sessionEnvelopeSchema    // <-- expects content.data to be the envelope
    }),
    ...
})
```
i.e., `content` must be `{ type: 'session', data: <envelope> }`.

### The Bridge: `preprocessMessageContent` (typesRaw.ts:417-431)

```typescript
// Accept new session wrapper shape and normalize to canonical wrapped shape.
// New shape:
// { role: 'session', content: { id, role, turn?, subagent?, ev }, meta? }
if (data.role === 'session' && data.content && typeof data.content === 'object') {
    const content = data.content as Record<string, unknown>;
    const looksLikeEnvelope = content.type !== 'session'
        && typeof content.id === 'string'
        && typeof content.role === 'string'
        && content.ev !== undefined;
    if (looksLikeEnvelope) {
        data.content = {
            type: 'session',
            data: content,    // <-- wraps the raw envelope
        };
    }
}
```

**This bridge DOES handle the mismatch** — it detects when `content` is a bare envelope (has `id`, `role`, `ev` but `type !== 'session'`) and wraps it into `{ type: 'session', data: content }` before Zod validation runs.

So for **live messages** (stored with `role: 'session'`, `content: <bare envelope>`), the preprocessor correctly rewraps them.

### `normalizeSessionEnvelope` — how it sets `isSidechain` (typesRaw.ts:538-553)

```typescript
function normalizeSessionEnvelope(envelope: SessionEnvelope, ...): NormalizedMessage | null {
    const parentUUID = envelope.subagent ?? null;
    const isSidechain = parentUUID !== null;
    ...
```

`isSidechain` is set from `envelope.subagent`. If `envelope.subagent` is absent (not set by `mapClaudeLogMessageToSessionEnvelopes` for sidechain messages), `isSidechain` will be `false` even for real sidechain messages.

---

## Summary: Where does `isSidechain` break for historical messages?

| Step | What happens | isSidechain status |
|------|-------------|-------------------|
| `sdkToLogConverter.convert()` | Sets `body.isSidechain = true` | Correct |
| `mapClaudeLogMessageToSessionEnvelopes(body, ...)` | Converts body → SessionEnvelope(s); sets `envelope.subagent` (or not) | **Key question — does it set `envelope.subagent` for sidechain messages?** |
| `enqueueSessionProtocolEnvelope` | Stores `{role:'session', content: envelope}` | Role is correct |
| `preprocessMessageContent` | Rewraps bare envelope to `{type:'session', data: envelope}` | Correct |
| `normalizeSessionEnvelope` | Reads `envelope.subagent ?? null` for isSidechain | Depends on whether subagent was set |
| Legacy path (duplex=true) | Skipped by `meta.duplex` check | N/A for new clients |
| Legacy path `role:'agent'` output | `raw.content.data.isSidechain` read directly (typesRaw.ts:818) | Would be correct, but skipped |

### Root cause hypothesis (inferred)

The chain is:
1. `body.isSidechain === true` is confirmed at `sendClaudeSessionMessage` entry.
2. `mapClaudeLogMessageToSessionEnvelopes` is the function that must translate `body.isSidechain` → `envelope.subagent`. If it does not set `envelope.subagent` for sidechain messages, the session protocol envelope is written without `subagent`, and the reader at `normalizeSessionEnvelope` infers `isSidechain = false`.
3. The legacy duplex path DOES carry `isSidechain` correctly (via `data.isSidechain`), but is **skipped unconditionally** by the `meta.duplex` guard in `normalizeRawMessage`.

**The critical uninvestigated link**: `mapClaudeLogMessageToSessionEnvelopes` in `packages/happy-cli/src/claude/sessionProtocolMapper.ts` — does it copy `body.isSidechain` / `body.parent_tool_use_id` into `envelope.subagent`?

This is the single function not yet read. If it fails to set `envelope.subagent`, that is the root cause of `isSidechain === false` on historical messages.
