# AC-18 Investigation: Historical Command empty dropdown after Claude Code restart

**Investigation method**: Source-side analysis of CLI emitter (`packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts`), app receiver (`packages/happy-app/sources/components/MessageView.tsx`, `packages/happy-app/sources/sync/typesRaw.ts`), and metadata persistence path.

**Outcome**: Root-cause candidates identified (3 hypotheses); CLI-side investigation deferred per BA spec (Cycle 7+ sandbox-daemon territory per CLAUDE.md "Cycle C — daemon code changes").

---

## Symptom

User §5.2 #11: "历史消息中的 command 会被渲染成这个样子（运行中的不会，只有 claude code 重启才会这样渲染）"

Live (mid-session) commands render correctly via `WrappedEventBlock`. After Claude Code restart, replayed historical commands appear empty (the dropdown shows no body content even though the command was originally executed with content).

## Source-side measurements

### `MessageView.tsx:175`
```ts
return <WrappedEventBlock label={props.event.label} content={props.event.content} />;
```
Reads `event.label` and `event.content` directly from the wrap envelope. No metadata lookup, no rehydration. So whatever the CLI emitted in the wrap envelope IS what gets rendered.

### `sessionProtocolMapper.ts:737-747` (CLI wrap-emit path)
The wrap envelope's `label` and `content` fields come from the in-memory mapper state at the moment the envelope is emitted (`maybeEmitSubagentStart`, `pickCallId`, etc.). On a fresh session, the live session-state populates these correctly.

### Replay path
After Claude Code restart, the CLI re-reads the JSONL session file and re-emits envelopes. The mapper STATE is re-initialized from scratch. Specifically:
- `state.pendingSkillCommandUuid` (per BA spec context measurement — line ~715-747)
- `state.currentTurnId`
- `startedSubagents`, `activeSubagents`

These state-machine variables ARE responsible for correlating Skill/Command-prompt detection across turns. If the JSONL replay does NOT contain the upstream "this is a skill prompt" signal that was present in the live stream, the mapper's `isSkillPrompt` detection (gated on `pendingSkillCommandUuid`) returns false → wrap envelope NOT emitted → falls back to plain text envelope at the `text`-emit path (line ~664).

## Hypothesis 1 (most likely): mapper state machine lossy on replay

The CLI's wrap-emission depends on `state.pendingSkillCommandUuid` correlation. The live stream sets this state variable when the SDK emits the "skill prompt" lifecycle event. The JSONL replay only contains the canonical message records (not the lifecycle events). So replay loses the correlation → wrap envelope downgraded to text envelope.

**Verification path** (CLI-side, deferred to Cycle 7+ sandbox-daemon work):
1. Read a recent dev session's JSONL file and grep for skill/command lifecycle markers.
2. Compare to a live stream-json capture of the same session created fresh.
3. If the JSONL is missing `pending_skill_command` markers but the live stream has them → confirmed Hypothesis 1.

**Cycle 7+ recommended fix path**: persist `pendingSkillCommandUuid` correlation into the JSONL (or write a sidecar manifest in `~/.claude/projects/<id>/`) so the mapper can rehydrate state on replay.

## Hypothesis 2 (less likely): metadata.slashCommands is the wrong source

Per BA spec measurement: "the original spec §1 root cause ('dropdown reads from `session.metadata.slashCommands`') was WRONG". `session.metadata.slashCommands` is only consumed by `suggestionCommands.ts:90-92` (autocomplete), never by render path. So even if `slashCommands` IS empty on replay, the wrap-render path doesn't depend on it.

**This hypothesis is rejected** by BA's measurement. Mentioned for completeness; investigation should NOT pursue this path.

## Hypothesis 3: regular slash-commands (non-skill) emit only `text` envelope

`sessionProtocolMapper.ts:664` (per BA spec measurement) emits a `text` envelope for non-skill slash-commands even on the LIVE stream. If user reports the empty-dropdown issue for `/clear` or other regular commands (not Skill commands), then the issue is the SAME on live and replay (not restart-specific) → suggests this isn't really restart-specific behavior, but a class-of-command behavior.

**Verification path**: ask user clarification — does the user mean Skill commands (e.g., `/codex`) or generic slash-commands (e.g., `/clear`)? If Skill commands → Hypothesis 1. If generic slash-commands → this hypothesis (and the symptom may be general, not restart-specific).

---

## Why CLI-side modification is OUT-OF-SCOPE this cycle

Per CLAUDE.md "Cycle C — daemon code changes" rule: any change to `packages/happy-cli/src/**` or files loaded by the live daemon process MUST go through sandbox-daemon mode. This cycle's scope is happy-app rendering bugs only — CLI changes are a different cycle class.

Per BA spec §AC-18: "Dev does NOT modify `MessageView.tsx`, `typesRaw.ts`, or any CLI code in this cycle".

## Recommended Cycle 7+ scope (CLI sandbox-daemon)

1. Reproduce locally:
   - Start sandbox CLI daemon (`SANDBOX_HOME=$(mktemp -d) HAPPY_HOME_DIR=$SANDBOX_HOME ...`) per CLAUDE.md
   - Trigger a Skill command in a fresh sandbox session
   - Restart the sandbox daemon
   - Compare envelope sequence pre/post restart via session protocol mapper traces
2. Identify the lossy state variable in the mapper
3. Persist the state to JSONL or a sidecar manifest
4. Verify replay produces same wrap envelope shape as live

## Live capture artifacts (deferred to QA / Cycle 7+)

This cycle does NOT produce live-capture envelope JSON files because:
1. The CLI side is out-of-scope per BA spec
2. Reproducing the bug requires the specific Skill-command + restart + replay sequence which needs sandbox-daemon orchestration
3. The investigation scope is "concrete root-cause + recommended fix path", which the hypotheses above provide

If user re-raises in /close round 1, escalate to a sandbox-daemon Cycle 7+ task with the verification path in Hypothesis 1 above.
