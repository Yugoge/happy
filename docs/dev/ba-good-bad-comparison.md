# Good vs Bad Session Comparison: Why Resumed Sessions Produce 0 Subagent Envelopes

**Date**: 2026-04-19
**Investigator**: BA subagent

---

## Sessions Compared

| | Good | Bad |
|---|---|---|
| Session ID | `cmnw5ebg81gbnnz15lxuzne4h` | `cmnrd6fzj0o9vnz1531ie1zoj` |
| Tag (Claude UUID) | `620cc0f4-d507-49aa-a1a6-c94bbd1ea627` | `064c841f-4661-4df7-a81d-2c7e964be18f` |
| Created | 2026-04-12 19:19:47 | 2026-04-09 10:58:46 |
| Total messages | 121 | 1041 |
| Message duration | 38 seconds | 5.5 seconds |
| Agent tool starts | 1 | 7 |
| Subagent envelopes | 55 | 0 |

---

## Root Cause: Session Type Difference

### Good session — LIVE session

The good session had 121 messages spanning 38 seconds. This indicates a real-time Claude
session with interleaved thinking pauses between messages. The Agent tool ran live: the
Claude SDK emitted subagent messages via its live stream with `parent_tool_use_id` set.

Path: `SDK live stream` → `sdkToLogConverter.convert()` (marks `isSidechain: true`) →
`messageQueue.enqueue()` → `session.client.sendClaudeSessionMessage()` → `sessionProtocolMapper`
→ subagent envelopes created.

### Bad session — RESUME-only (sendExisting upload, no live activity)

The bad session had 1041 messages ALL sent within 5.5 seconds (10:58:46.794 to 10:58:52.306).
This is not a real-time conversation — it is a mechanical bulk upload of prior JSONL history
via the `sendExisting` path. After the upload completed, zero new messages arrived. There was
no live Claude process running for this session.

---

## Why Subagent Messages Are Missing from sendExisting

### Architecture of JSONL files on disk

The Claude SDK maintains two categories of JSONL files:

1. **Main session JSONL**: `~/.claude/projects/<project>/<sessionUUID>.jsonl`
   - Written by `sdkToLogConverter.ts` with `entrypoint: "remote"`
   - Contains: assistant/user/system messages for the main Claude process
   - Does **NOT** contain sidechain/subagent messages
   - Verified: 821 messages in `8710e315.jsonl`, isSidechain count = **0**

2. **Subagent JSONL files**: `~/.claude/projects/<project>/<sessionUUID>/subagents/agent-<agentId>.jsonl`
   - Written independently by the Claude SDK with `entrypoint: "sdk-ts"`
   - Contains: sidechain messages with `isSidechain: true`
   - Verified: `agent-a0e6e8965c65df6c8.jsonl` has 85 messages all with `isSidechain: true`

### How the scanner works

`sessionScanner.ts` → `readSessionLog()` constructs path:
```
join(projectDir, `${sessionId}.jsonl`)
```

This reads **only** the main JSONL file. It has **no code** to enumerate or read the
`subagents/` subdirectory. The subagent JSONL files on disk are the SDK's own archival
copies and are never consumed by the happy-cli scanner.

### The sendExisting gap

When a session is resumed (`--resume <UUID>`), `uploadResumeHistory` is called:

```typescript
async function uploadResumeHistory(session: Session) {
    const scanner = await createSessionScanner({
        sessionId: session.claudeArgs[idx + 1],
        sendExisting: true,
        workingDirectory: session.path,
        onMessage: (m) => {
            if (m.type !== 'summary' && !(m as any).isMeta) {
                session.client.sendClaudeSessionMessage(m);
            }
        }
    });
    await scanner.cleanup();
}
```

The scanner reads the main JSONL only. Since the main JSONL contains zero isSidechain
messages, the `sendClaudeSessionMessage` call never receives any sidechain content.
The mapper receives Agent `tool_use` blocks (creating `tool-call-start` envelopes) but
never receives the matching sidechain messages that would trigger `consumeTaskPromptSubagent`
and generate subagent `start`/`message`/`stop` envelopes.

**Result: 7 `tool-call-start` envelopes from Agent tool_use, 0 subagent envelopes.**

---

## Timeline Verification

```
Bad session message timing:
  seq 1-51:    10:58:46.794 - 10:58:46.991  (first batch, rapid-fire)
  seq 52-53:   10:58:47.168 - 10:58:47.197  (second sendExisting batch: 1.6MB)
  seq 54-102:  10:58:47.289 - 10:58:47.644  (continuing)
  seq 103:     10:58:47.666                  (3rd sendExisting batch: 1.9MB)
  seq 104-112: 10:58:47.757 - 10:58:47.812
  seq 113:     10:58:47.812                  (4th sendExisting batch: 2.3MB)
  ...
  seq 1041:    10:58:52.306                  (LAST message — session ends)

Total duration: 5.512 seconds. No activity after this.
```

The large blobs (1.6MB, 1.9MB, 1.9MB, 2.3MB) at regular intervals are the batched
`sendExisting` uploads. The bad session is a **multi-resume** session: an old JSONL
was uploaded in multiple batches corresponding to multiple earlier sessions that were
chained via `--resume`.

---

## Supporting Evidence

### Main JSONL verified to have zero sidechain content

```
File: 8710e315-c92b-4883-98c5-429cacc38fd8.jsonl (a session with known Agent tool use)
- Total valid JSON lines: 821
- isSidechain count: 0
- Agent/Task tool_use blocks: 16
```

### Subagent files in separate directory

```
8710e315-c92b-4883-98c5-429cacc38fd8/subagents/
├── agent-a0e6e8965c65df6c8.jsonl  (85 lines, all isSidechain: true, entrypoint: sdk-ts)
├── agent-a388e6f24713c8458.jsonl
├── agent-a5a45440fb19f4099.jsonl
└── ... (more files)
```

### Scanner code does not read subagents/ directory

```typescript
// sessionScanner.ts line 211-222
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    // Only reads <sessionId>.jsonl — no subdirectory traversal
    ...
}
```

---

## Why Good Session Has 55 Subagent Envelopes

1. Claude SDK runs live, encounters an Agent tool call
2. Spawns subagent process; subagent produces messages with `parent_tool_use_id` set
3. SDK emits these messages to the **live callback** (`buildOnMessage`)
4. `sdkToLogConverter.convert()` detects `parent_tool_use_id` → sets `isSidechain: true`
5. `queueLogMessage()` routes to `messageQueue.enqueue()`
6. Queue delivers to `session.client.sendClaudeSessionMessage(logMessage)`
7. `sessionProtocolMapper` receives message with `isSidechain: true`
8. Mapper calls `consumeTaskPromptSubagent()` → matches against queued Agent prompt
9. Emits `start` envelope (subagent type), then processes subsequent sidechain messages
10. Emits per-message envelopes (tool-call-start, text, etc.) under the subagent scope

Total: 1 Agent call × ~55 envelope events = 55 subagent envelopes.

---

## Implications

### sendExisting path is fundamentally incapable of replaying subagent envelopes

No code change to `sendExisting` can recover subagent data, because:
- The sidechain messages are **not stored** in the main JSONL
- The subagent JSONL files in `subagents/` are SDK-internal files, not read by happy-cli
- The only source of sidechain content is the live SDK stream

### Options to fix resumed sessions showing subagent data

**Option A (read subagent files)**: Modify `sessionScanner.ts` → `readSessionLog` to also
enumerate and read `<sessionId>/subagents/agent-*.jsonl`. Each message already has
`isSidechain: true` and the correct `parentUuid` chain. This would enable `sendExisting`
to deliver sidechain messages.

**Option B (accept the limitation)**: Document that resumed sessions do not show subagent
content. This is acceptable if the use case (overnight dev sessions) rarely needs to view
subagent details of old resumed history.

**Option C (hybrid)**: On resume, scan the subagent files and inject them interleaved with
main session messages at the correct position based on `parentUuid` chain.

---

## Code References

| File | Line | Relevance |
|------|------|-----------|
| `packages/happy-cli/src/claude/claudeRemoteLauncher.ts` | 74-83 | `uploadResumeHistory` — sendExisting trigger |
| `packages/happy-cli/src/claude/utils/sessionScanner.ts` | 211-222 | `readSessionLog` — only reads main JSONL |
| `packages/happy-cli/src/claude/utils/sessionScanner.ts` | 44-74 | `initExistingMessages` — sendExisting path |
| `packages/happy-cli/src/claude/utils/sdkToLogConverter.ts` | 88-97 | Sets `isSidechain: true` for live stream msgs |
| `packages/happy-cli/src/claude/utils/sessionProtocolMapper.ts` | 309-330 | `ensureSessionSubagentIdForProviderSubagent` |
| `packages/happy-cli/src/claude/utils/sessionProtocolMapper.ts` | 219-231 | `queueTaskPromptSubagent` |
