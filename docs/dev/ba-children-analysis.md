# BA Analysis: Agent/Task Sidechain Children Pipeline

**Date**: 2026-04-10
**Issue**: Agent/Task tool sidebar shows only tool calls, missing subagent text messages

---

## Executive Summary

**The pipeline DOES emit and process `agent-text` messages for sidechains correctly.** Text messages from subagent conversations ARE present in `message.children`. The issue is NOT that text is missing from children -- it is that the rendering component (`TaskViewFull`) correctly receives both `agent-text` and `tool-call` children but may have a rendering or filtering issue.

---

## Question-by-Question Findings

### Q1: Does the CLI emit `t: 'text'` envelopes with `subagent` field for sidechain text?

**YES** -- confirmed.

**Evidence** (`sessionProtocolMapper.ts`):

1. **Line 531-538** -- Assistant messages (both mainchain and sidechain) emit text envelopes:
   ```typescript
   if (block.type === 'text' && typeof block.text === 'string') {
       envelopes.push(createEnvelope('agent', { t: 'text', text: block.text }, { turn: turnId, subagent }));
   }
   ```
   The `subagent` variable is set from `resolveProviderSubagent()` and passed through. For sidechain assistant messages, `subagent` is the CUID2 session subagent ID.

2. **Line 542-544** -- Thinking blocks also emit with `subagent`:
   ```typescript
   if (block.type === 'thinking' && typeof block.thinking === 'string') {
       envelopes.push(createEnvelope('agent', { t: 'text', text: block.thinking, thinking: true }, { turn: turnId, subagent }));
   }
   ```

3. **Line 680-683** -- Sidechain user messages with string content also emit as agent text with `subagent`:
   ```typescript
   if (message.isSidechain) {
       envelopes.push(createEnvelope('agent', { t: 'text', text }, { turn: turnId, subagent }));
   }
   ```

4. **Line 829-831** -- Sidechain user messages with array content also emit text blocks:
   ```typescript
   if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
       envelopes.push(createEnvelope('agent', { t: 'text', text: block.text }, { turn: turnId, subagent }));
   }
   ```

**Conclusion**: The CLI mapper correctly emits `{ t: 'text', text: '...' }` envelopes with `subagent` field for ALL sidechain text content (assistant text, thinking, and user text).

---

### Q2: Does the App normalizer preserve `isSidechain: true` for text envelopes?

**YES** -- confirmed.

**Evidence** (`typesRaw.ts`, `normalizeSessionEnvelope()`, lines 605-641):

```typescript
if (envelope.ev.t === 'text') {
    // ...
    return {
        id: messageId,
        localId,
        createdAt: messageCreatedAt,
        role: 'agent',
        isSidechain,          // <-- SET FROM: parentUUID !== null (line 553)
        content: [
            envelope.ev.thinking ? {
                type: 'thinking',
                thinking: envelope.ev.text,
                uuid: contentUUID,
                parentUUID          // <-- SET FROM: envelope.subagent ?? null (line 552)
            } : {
                type: 'text',
                text: envelope.ev.text,
                uuid: contentUUID,
                parentUUID          // <-- SET FROM: envelope.subagent ?? null (line 552)
            }
        ],
        meta
    };
}
```

Key derivation (lines 552-553):
```typescript
const parentUUID = envelope.subagent ?? null;
const isSidechain = parentUUID !== null;
```

When `envelope.subagent` is a CUID2 value (as set by the CLI for sidechain envelopes), `parentUUID` is non-null, and `isSidechain` is `true`.

**Conclusion**: The normalizer correctly preserves `isSidechain: true` and sets `parentUUID` to the subagent CUID2 for all sidechain text envelopes.

---

### Q3: Does the reducer create `agent-text` kind messages from sidechain text?

**YES** -- confirmed.

**Evidence** (`reducer.ts`, Phase 4, lines 932-954):

```typescript
} else if (msg.role === 'agent') {
    for (let c of msg.content) {
        if (c.type === 'text' || c.type === 'thinking') {
            const text = c.type === 'thinking' ? c.thinking : c.text;
            // ...duplicate check...
            let mid = allocateId();
            const isThinking = c.type === 'thinking';
            let textMsg: ReducerMessage = {
                id: mid,
                realID: msg.id,
                role: 'agent',
                createdAt: msg.createdAt,
                text: isThinking ? `*${c.thinking}*` : c.text,
                isThinking,
                tool: null,
                event: null,
                meta: msg.meta,
            };
            state.messages.set(mid, textMsg);
            existingSidechain.push(textMsg);    // <-- ADDED TO SIDECHAIN ARRAY
        }
    }
}
```

Then in `convertReducerMessageToMessage()` (lines 1189-1197):
```typescript
} else if (reducerMsg.role === 'agent' && reducerMsg.text !== null) {
    return {
        id: reducerMsg.id,
        localId: null,
        createdAt: reducerMsg.createdAt,
        kind: 'agent-text',          // <-- THIS IS THE KIND
        text: reducerMsg.text,
        isThinking: reducerMsg.isThinking,
        meta: reducerMsg.meta
    };
}
```

And the children are populated (lines 1199-1208):
```typescript
} else if (reducerMsg.role === 'agent' && reducerMsg.tool !== null) {
    let childMessages: Message[] = [];
    let children = reducerMsg.realID ? state.sidechains.get(reducerMsg.realID) || [] : [];
    for (let child of children) {
        let childMessage = convertReducerMessageToMessage(child, state);
        if (childMessage) {
            childMessages.push(childMessage);
        }
    }
    return {
        kind: 'tool-call',
        children: childMessages,   // <-- CHILDREN INCLUDE agent-text AND tool-call
        // ...
    };
}
```

**Conclusion**: The reducer correctly creates `ReducerMessage` objects with `role: 'agent'` and `text` set for sidechain text, stores them in the sidechain array, and `convertReducerMessageToMessage` converts them to `{ kind: 'agent-text', text: '...' }` Message objects within `children`.

---

### Q4: What types of messages are actually in `message.children`?

Based on the code analysis, `message.children` for a Task/Agent tool call contains an array of `Message` objects that can be any of the four `Message` union types:

1. **`agent-text`** (kind: 'agent-text') -- Subagent's text output and thinking blocks
2. **`tool-call`** (kind: 'tool-call') -- Subagent's internal tool calls (Read, Write, Bash, etc.)
3. **`user-text`** (kind: 'user-text') -- The initial sidechain prompt (from `type: 'sidechain'` content)
4. **`agent-event`** (kind: 'agent-event') -- Mode switch events (rare in sidechains)

The complete flow for a typical subagent conversation in `children`:
```
[user-text: "the task prompt"]           <- sidechain root
[agent-text: "Let me help with that"]    <- subagent's first response text
[tool-call: Read file X]                 <- subagent's tool call
[agent-text: "I found the issue..."]     <- subagent's text after tool
[tool-call: Edit file Y]                 <- subagent's next tool call
[agent-text: "Done! Here's what I did"]  <- subagent's final text
```

---

### Q5: If text is missing, WHERE in the pipeline does it get lost?

**Text is NOT lost in the pipeline.** The full chain works correctly:

1. CLI: emits `{ t: 'text', subagent: CUID2 }` envelopes -- WORKS
2. Server: stores session protocol messages verbatim -- WORKS
3. App normalizer: creates `NormalizedMessage` with `isSidechain: true`, `parentUUID: CUID2` -- WORKS
4. Tracer: assigns `sidechainId` based on parentUUID/CUID2 matching to tool call -- WORKS
5. Reducer Phase 4: creates `ReducerMessage` with text, pushes to sidechain array -- WORKS
6. `convertReducerMessageToMessage`: converts to `{ kind: 'agent-text' }` in children -- WORKS

**However**, there is one potential issue in the tracer that could cause messages to be dropped:

**Tracer CUID2 handling** (`reducerTracer.ts`, line 285):
```typescript
if (!isUuidLike(parentUuid)) {
    state.processedIds.add(message.id);
    const tracedMessage: TracedMessage = { ...message };
    results.push(tracedMessage);
    continue;   // <-- No sidechainId assigned!
}
```

When `parentUUID` is a CUID2 (not UUID format), `isUuidLike()` returns false, and the message is processed as a **standalone message** with no `sidechainId`. This means it falls through to `nonSidechainMessages` in the reducer and gets processed as a regular agent text message -- NOT as a sidechain child.

**BUT** -- lines 189-195 of the tracer also check:
```typescript
for (const parentId of getToolCallParentIds(content)) {
    state.toolCallToMessageId.set(parentId, message.id);
    const subagentOrphans = processOrphans(state, parentId, message.id);
    // ...
}
```

And line 261:
```typescript
const parentSidechainId = state.uuidToSidechainId.get(parentUuid) || state.toolCallToMessageId.get(parentUuid);
```

So CUID2 parentUUIDs CAN be resolved via `toolCallToMessageId` if the tool call was already processed. The issue only occurs if the sidechain text message arrives BEFORE its parent tool call AND the parentUUID is a CUID2 (not UUID).

**For the session protocol path** (which is the current path), ALL sidechain messages have `parentUUID = envelope.subagent` which is a CUID2. If the tool-call-start envelope (which registers the CUID2 in `toolCallToMessageId`) arrives before the text envelopes, everything works. If messages arrive out of order, the CUID2 fails `isUuidLike()` and becomes a standalone message -- **this is the potential loss point**.

---

## Critical Distinction: Two Data Paths

### Path A: Session Protocol (current, via CLI sessionProtocolMapper)
- Messages arrive as `{ role: 'session', content: { type: 'session', data: envelope } }`
- `normalizeSessionEnvelope()` processes them
- `parentUUID` is set to `envelope.subagent` (a CUID2)
- The tracer uses `toolCallToMessageId` to match CUID2 parentUUIDs

### Path B: Legacy Output (historical, via JSONL replay)
- Messages arrive as `{ role: 'agent', content: { type: 'output', data: { type: 'assistant', isSidechain: true, uuid: '...', parentUuid: '...' } } }`
- `normalizeRawMessage()` processes them
- `parentUUID` comes from the JSONL parentUuid field (UUID format)
- The tracer uses `uuidToSidechainId` to match UUID parentUUIDs
- Additionally, `type: 'sidechain'` content matches via prompt text

### Key Insight
For session protocol messages (the live path), the ordering of envelopes within a single server message batch is critical. The CLI mapper emits `tool-call-start` BEFORE the buffered subagent messages (lines 580-584), which means the CUID2 is registered in `toolCallToMessageId` before children reference it. **This ordering should be correct.**

---

## Conclusion

**The data pipeline is correct.** `agent-text` children DO appear in `message.children` for Task/Agent tool calls. If the UI is not showing them, the issue is in the rendering layer (`TaskViewFull` component), not in the data layer.

### Next Steps for Investigation
1. Check `TaskViewFull` rendering -- does it filter `message.children` by kind?
2. Check if `TaskViewFull` only renders `tool-call` kind and skips `agent-text` kind
3. Add logging to TaskViewFull to dump `message.children.map(c => c.kind)` and verify actual data at render time
