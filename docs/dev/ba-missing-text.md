# Investigation: Missing Agent Text in Agent Sidebar

**Date**: 2026-04-19
**Scope**: Read-only analysis — no files modified

---

## Summary of Findings

Agent text messages (`kind: 'agent-text'`) ARE correctly produced by the reducer and placed into the sidechain array. They ARE correctly handled by `ChildMessageBlock` in `TaskViewFull`. The bug is elsewhere — specifically in **how `convertReducerMessageToMessage` looks up sidechain children** for the Agent (Task) tool-call.

---

## Step 1: TaskViewFull — what it renders

**File**: `packages/happy-app/sources/components/tools/views/TaskViewFull.tsx`

Key finding at **line 59–62**:

```typescript
{expanded && (
    <ChildMessageList messages={messages} metadata={metadata} sessionId={routeSessionId} />
)}
```

`ChildMessageList` receives the raw **`messages`** prop (not `filtered`). `useFilteredTools` is only used to compute the count in the header label (line 39: `toolCount = filtered.length`). So `useFilteredTools` is NOT the culprit for what gets rendered — the full `messages` array is iterated.

`ChildMessageBlock` at line 72–95 handles both `agent-text` (renders `<MarkdownView>`) and `tool-call` (renders `<ToolView>`). The rendering code is correct.

**Conclusion**: `useFilteredTools` filtering is NOT the drop point. The drop point must be upstream — in how `messages` is populated.

---

## Step 2: useFilteredTools — confirmed not the culprit

**File**: `packages/happy-app/sources/components/tools/views/TaskView.tsx`, lines 57–68

```typescript
export function useFilteredTools(messages: Message[], metadata: Metadata | null): FilteredTool[] {
    return React.useMemo(() => {
        const result: FilteredTool[] = [];
        for (const m of messages) {
            if (m.kind !== 'tool-call') continue;  // Only collects tool-calls for the COUNT
            ...
        }
        return result;
    }, [messages, metadata]);
}
```

This only builds a display list for the "(N)" count in the header. It does NOT affect what `ChildMessageList` renders. **Not the bug.**

---

## Step 3: Reducer Phase 4 — sidechain text IS created

**File**: `packages/happy-app/sources/sync/reducer/reducer.ts`, lines 982–1004

For sidechain messages with `role === 'agent'` and content `type === 'text'`, the reducer DOES create `ReducerMessage` entries with `role: 'agent'`, `text: c.text`, `tool: null`. These ARE pushed to `existingSidechain`:

```typescript
let textMsg: ReducerMessage = {
    id: mid,
    realID: msg.id,   // <-- realID = the sidechain NormalizedMessage's id
    role: 'agent',
    createdAt: msg.createdAt,
    text: isThinking ? `*${c.thinking}*` : c.text,
    isThinking,
    tool: null,
    event: null,
    meta: msg.meta,
};
state.messages.set(mid, textMsg);
existingSidechain.push(textMsg);   // <-- added to sidechain array
```

At line 1134: `state.sidechains.set(msg.sidechainId, existingSidechain);`

The key used to store the sidechain is **`msg.sidechainId`** — i.e., the `sidechainId` from the tracer, which is the **realID of the parent Task tool-call message** (from `NormalizedMessage`).

**Conclusion**: Text messages ARE in the sidechain array in state.

---

## Step 4: convertReducerMessageToMessage — THE BUG IS HERE

**File**: `packages/happy-app/sources/sync/reducer/reducer.ts`, lines 1262–1281

When converting a `tool-call` ReducerMessage (the Agent/Task tool), children are looked up as:

```typescript
} else if (reducerMsg.role === 'agent' && reducerMsg.tool !== null) {
    let childMessages: Message[] = [];
    let children = reducerMsg.realID ? state.sidechains.get(reducerMsg.realID) || [] : [];
    //                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                                              KEY: sidechains.get(reducerMsg.realID)
```

The lookup is `state.sidechains.get(reducerMsg.realID)`.

But sidechains are stored at `state.sidechains.set(msg.sidechainId, ...)`, where `msg.sidechainId` is the `realID` of the **parent Task NormalizedMessage**.

Now: what is `reducerMsg.realID` for the Task tool-call ReducerMessage?

Looking at how Task tool-calls are created (Phase 3, line 712):
```typescript
realID: msg.id,   // msg.id = the NormalizedMessage id for the Task tool-call
```

And the sidechain is stored at key `msg.sidechainId` (which is set by the tracer to = the Task's NormalizedMessage id).

**These should match** — `reducerMsg.realID` = Task NormalizedMessage id = `msg.sidechainId`.

So the lookup *should* work... unless the issue is that `convertReducerMessageToMessage` is called during `Phase 5 → collect changed messages` (lines 1184–1195), and at that point the **sidechain may not have been stored yet** for the SAME batch.

---

## Step 5: Timing / ordering analysis

**File**: `packages/happy-app/sources/sync/reducer/reducer.ts`, lines 1180–1194

```typescript
// Collect changed messages (only root-level messages)
for (let id of changed) {
    let existing = state.messages.get(id);
    if (!existing) continue;
    let message = convertReducerMessageToMessage(existing, state);
    if (message) {
        newMessages.push(message);
    }
}
```

`changed` is accumulated throughout Phases 1–5. The Task tool-call message is added to `changed` in Phase 4 (line 1152–1153):
```typescript
for (const [internalId, message] of state.messages) {
    if (message.realID === msg.sidechainId && message.tool) {
        changed.add(internalId);
        break;
    }
}
```

This happens AFTER `state.sidechains.set(msg.sidechainId, existingSidechain)` at line 1134. So by the time `convertReducerMessageToMessage` runs (Phase 6 collect), the sidechain IS in `state.sidechains`.

**Wait — what does the sidechain contain at that point?**

The sidechain contains `ReducerMessage` objects pushed in Phase 4. Each has `realID = msg.id` (the sidechain NormalizedMessage id) — NOT the Task's NormalizedMessage id.

When `convertReducerMessageToMessage` is called recursively on a child `ReducerMessage` with `role: 'agent'` and `text !== null`, it correctly returns an `agent-text` Message (lines 1252–1261). ✓

So the text SHOULD appear in `childMessages` and thus in the `tool-call` Message's `children` array.

---

## Step 6: What actually reaches TaskViewFull's `messages` prop

The `messages` prop passed to `TaskViewFull` comes from `ToolView`, which comes from the chat message rendering. Let me trace:

The `tool-call` Message for the Agent has `children: childMessages` populated by `convertReducerMessageToMessage`. This is passed as `messages` to `ToolView`, which passes it to `TaskViewFull`.

**If children is populated with both `agent-text` and `tool-call` entries, then `ChildMessageList` renders both.**

---

## Step 7: isDuplicateSidechainPrompt guard — analyzed

**File**: `packages/happy-app/sources/sync/reducer/reducer.ts`, lines 985–989

```typescript
for (let c of msg.content) {
    if (c.type === 'text' || c.type === 'thinking') {
        const text = c.type === 'thinking' ? c.thinking : c.text;
        if (c.type === 'text' && isDuplicateSidechainPrompt(existingSidechain, ownerPrompt, text)) {
            continue;  // <-- text messages can be SKIPPED here
        }
```

`isDuplicateSidechainPrompt` could drop agent text — see Step 8 for the full analysis.

---

## Step 10: The real structural issue found

Re-examining `convertReducerMessageToMessage` for the Task tool-call message at line 1265:

```typescript
let children = reducerMsg.realID ? state.sidechains.get(reducerMsg.realID) || [] : [];
```

`reducerMsg.realID` = the Task NormalizedMessage id.

But what IS the sidechain key? From Phase 4 line 958:
```typescript
const existingSidechain = state.sidechains.get(msg.sidechainId) || [];
```
And line 1134:
```typescript
state.sidechains.set(msg.sidechainId, existingSidechain);
```

The sidechain key = `msg.sidechainId` (from the traced sidechain NormalizedMessage), which the tracer sets to = the Task's `realID` (the original NormalizedMessage id of the Task tool-call). This matches `reducerMsg.realID`.

**So the lookup IS correct** and text IS in the sidechain. The children array contains text entries.

---

## Step 8: isDuplicateSidechainPrompt — analyzed, NOT the bug

**reducer.ts lines 227–237:**

```typescript
function isDuplicateSidechainPrompt(
    existingSidechain: ReducerMessage[],
    ownerPrompt: string | null,
    text: string,
): boolean {
    if (existingSidechain.length > 0 || !ownerPrompt) {
        return false;   // <-- returns false if sidechain is non-empty OR no ownerPrompt
    }
    return text.trim() === ownerPrompt;
}
```

This only returns `true` (and causes a drop) when ALL three conditions hold:
1. `existingSidechain.length === 0` (first message in the sidechain)
2. `ownerPrompt` exists (Task has a `prompt` input)
3. The text is EXACTLY equal to the prompt

This is a very narrow guard — it only drops the verbatim echo of the prompt as the first message. All subsequent text messages pass through. **Not the bug.**

---

## Step 9: Tracer sidechainId assignment — confirmed correct

**reducerTracer.ts lines 200–238:**

The tracer assigns `sidechainId = message.id` of the NormalizedMessage that contains the Agent/Task tool-call (key: `state.promptToTaskId.set(content.input.prompt, message.id)` at line 207, then retrieved at line 235–238).

This is exactly the same value as `reducerMsg.realID` in the Task tool-call ReducerMessage (created in Phase 2, line 854: `realID: msg.id`).

So `state.sidechains.get(reducerMsg.realID)` in `convertReducerMessageToMessage` (line 1265) uses the correct key and WILL find the sidechain array.

---

## DEFINITIVE CONCLUSION

**The entire pipeline from reducer to rendering is structurally correct.** Every step handles `agent-text` properly:

| Location | File:Line | What happens | Verdict |
|----------|-----------|--------------|---------|
| Phase 4 text creation | reducer.ts:985-1004 | Creates text ReducerMessage, pushes to sidechain | CORRECT |
| isDuplicateSidechainPrompt guard | reducer.ts:987/232 | Only drops verbatim prompt echo as first message | NOT THE BUG |
| state.sidechains.set | reducer.ts:1134 | Stores sidechain under sidechainId = Task msg.id | CORRECT |
| tracer sidechainId | reducerTracer.ts:238 | sidechainId = Task NormalizedMessage.id | CORRECT |
| convertReducerMessageToMessage lookup | reducer.ts:1265 | sidechains.get(realID) = sidechains.get(Task msg.id) | CORRECT — keys match |
| convertReducerMessageToMessage agent-text branch | reducer.ts:1252-1261 | Returns agent-text Message | CORRECT |
| ChildMessageList | TaskViewFull.tsx:20-31 | Iterates full messages prop | CORRECT |
| ChildMessageBlock agent-text case | TaskViewFull.tsx:72-79 | Renders MarkdownView | CORRECT |
| useFilteredTools | TaskView.tsx:57-68 | Only used for count label, NOT for rendering | NOT THE BUG |

**This means the bug CANNOT be diagnosed definitively by code reading alone.** The code is structurally correct but the text is not appearing. This points to one of:

1. **Runtime data issue**: The subagent's actual output messages may not be classified as sidechain messages by the tracer — possibly the sidechain text arrives but `isSidechain: true` is not set on those NormalizedMessages. The tracer only processes messages with `isSidechain: true`.

2. **Missing browser observation**: The actual `children` array on a rendered Agent tool-call Message has never been measured. It may contain `agent-text` entries that are present but hidden by some CSS/layout issue rather than missing entirely.

3. **Normalization gap**: The `typesRaw.ts` normalization step (before the reducer) may not be producing `isSidechain: true` on the text-content messages from the subagent. If sidechain text messages are normalized as regular non-sidechain messages, Phase 4 never processes them — they go through Phase 1 as regular `agent-text` at root level instead.

---

## Most Likely Root Cause (inferred, not observed)

**Diagnosis layer: L4 (data/normalization)**

The sidechain text messages may be normalized with `isSidechain: false` (or lack `isSidechain`), causing them to flow through Phase 1 as **root-level** `agent-text` messages rather than being stored in `state.sidechains`. They would then appear in the main conversation thread — interspersed between user messages — rather than inside the Task's `children` array.

The fix would be in `typesRaw.ts` normalization or the tracer's `isSidechain` detection logic.

**Alternatively**, the text messages may arrive with `isSidechain: true` but lack a matching `parentUUID` linkage, so the tracer cannot assign a `sidechainId` to them. They end up in `tracedMessages` as `isSidechain && !sidechainId` — unresolved sidechain messages that are discarded (`nonSidechainMessages` filter: `!msg.sidechainId`).

---

## Required Browser Observation (mandatory before fix)

1. Open DevTools in the running dev.life-ai.app
2. Find an Agent message with tool calls in the conversation
3. Inspect React component tree → find the `TaskViewFull` → check the `messages` prop
4. Count `kind` values: are there `agent-text` entries? Or only `tool-call`?
5. If no `agent-text` in `messages`, then check whether those texts appear as root-level messages in the conversation
6. Enable `ENABLE_LOGGING` in reducer.ts and check `[REDUCER] Phase 4 stored sidechain` log — look at `sidechainMessageKinds`

---

## Files Read

- `packages/happy-app/sources/components/tools/views/TaskViewFull.tsx`
- `packages/happy-app/sources/components/tools/views/TaskView.tsx`
- `packages/happy-app/sources/sync/typesMessage.ts`
- `packages/happy-app/sources/sync/reducer/reducer.ts` (full key sections via grep + targeted reads)
- `packages/happy-app/sources/sync/reducer/reducerTracer.ts` (lines 135–280)
