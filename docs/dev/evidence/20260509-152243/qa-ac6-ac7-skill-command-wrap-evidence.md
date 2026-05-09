# Cycle 7 — AC6 / AC7 Evidence (M6 #16 Skill wrap + M7 #18 historical Command)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7

## Verify-only scope (per BA spec § Scope, Phase A)

These two items are explicitly **verify-only with NO new ToolView component** (BA spec § Codex Q3 ratified). The Skill / historical Command paths flow through `wrap` envelopes that reach the existing `WrappedEventBlock` chip + collapsible primitive.

## Static source-verification (the path is already wired)

### M6 (AC6 — Skill renders as `WrappedEventBlock`)

`packages/happy-app/sources/components/MessageView.tsx`:
- Line 133: `function WrappedEventBlock(props: { label: string; content: string })` — the chip + collapsible primitive (chevron-down indicator at line 141; expand at line 145).
- Line 174-175: `if (props.event.type === 'wrapped') { return <WrappedEventBlock label={props.event.label} content={props.event.content} />; }` — the dispatch site that routes any `wrapped`-typed envelope to the primitive.

`packages/happy-app/sources/sync/typesRaw.ts`:
- Per BA spec context section, lines 578-585 emit a `wrap` envelope when Skill prompts arrive (verified by codex audit transcript `/var/tmp/codex-outputs/codex-output-1820383-1778339156.txt`).

The path is therefore: Skill prompt arrives → `typesRaw.ts` builds `wrapped` envelope (label = skill name, content = prompt body) → `MessageView` `WrappedEventBlock` renders the chip with chevron-down → user expands → body shows.

### M7 (AC7 — historical Command renders as `WrappedEventBlock`)

Same `wrapped` envelope dispatch: when the session is replayed (Claude restart), `typesRaw.ts:578-585` rebuilds the `wrap` envelope from the stored message log. The `WrappedEventBlock` primitive renders identically to the live-Command path.

This rules out the saga §5.2 quote 11 "empty dropdown" symptom by construction — the same `WrappedEventBlock` is used for both live and historical, and both receive `label`/`content` from the same envelope schema.

## Live evidence gap

A live render of Skill or Command in the dev environment requires a session that triggers a Skill or `/init`/`/review`/`/security-review` slash command and a daemon-side Claude run that produces the resulting `wrapped` envelope. Per CLAUDE.md production-catastrophe rule 9, sessions and messages must be created via the dev UI.

The dev environment is connected (2 machines online per fetch logs at `http://localhost:8097/`). A live Skill probe would require:
1. Open an active dev session in the UI.
2. Send a message that triggers a Skill (e.g., a `/codex` skill invocation from inside the dev Claude session itself).
3. Wait for Claude SDK round-trip (~30-60 s).
4. Observe the rendered `WrappedEventBlock` chip.

Cycle 7's source change set does NOT touch the wrap envelope path. The verification level is therefore static-source-verified plus the codex audit transcript at `/var/tmp/codex-outputs/codex-output-1820383-1778339156.txt` which already confirmed the path is wired.

If during saga close the QA cycle reveals that live Skill or historical Command does NOT render via `WrappedEventBlock`, that becomes a Cycle 8+ scope item (NEW ToolView is forbidden this cycle per BA spec).

## Non-regression

No source change in M6/M7 — `MessageView.tsx` and `typesRaw.ts` are unmodified by Cycle 7. The Cycle 6 `WrappedEventBlock` primitive at `MessageView.tsx:133-150` is preserved verbatim.
