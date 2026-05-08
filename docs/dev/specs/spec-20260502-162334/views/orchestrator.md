<!-- AUTO-GENERATED VIEW for orchestrator | source: docs/dev/specs/spec-20260502-162334.md | extracted: 2026-05-02T19:56:02Z -->

# orchestrator view of spec-20260502-162334

**Monolith**: docs/dev/specs/spec-20260502-162334.md

---

## Role Mandate (from spec)

> # Spec: Codex 4-fix runtime closure — make declared fixes actually visible to user

---

## Pipeline Workflow

The action plan to satisfy this acceptance criterion (numbered S1–S7) is the implementation contract. **Dependency order is mandatory** — see the dependency graph below; a step's verification cannot start until all its predecessors are complete:

```
S1 (CLI source) ─┐
S5 (CLI source) ─┼─→ S-BUILD (CLI dev build) ─→ S4 (REQUEST → user; PAUSE)
S6 (CLI source) ─┘                                   │
S2 (App source) ──────→ S3 (web image rebuild) ──────┴─→ S7 (QA live matrix)
```

S4 is a **PAUSE-PENDING-USER** boundary: the dev subagent finishes S1+S5+S6+S-BUILD and S2+S3, then outputs the S4 REQUEST and STOPS. The /dev orchestrator marks the cycle as `awaiting-user`. S7 cannot start until the user reports back that the S4 SOP completed successfully.

- **S1. Open raw event protocol gate** — `packages/happy-cli/src/codex/codexAppServerClient.ts:802` must change from `experimentalRawEvents: false` to `experimentalRawEvents: true`. The flag is part of `NewConversationParams` (see `codexAppServerTypes.ts:19-32`) and is sent on the **`thread/start`** RPC (NOT `turn/start`). Runtime verification: after S-BUILD, after S4, log/inspect the `thread/start` request payload from `/root/.happy-dev/logs/` for the next Codex thread and confirm the flag is present and `true`.

---

## Anti-Patterns

### Hard Prohibitions (NON-NEGOTIABLE — violation = automatic fail and rollback)

The four fixes in this spec are scoped to the **Codex** rendering path. They MUST NOT regress, alter, or visibly affect the **Claude Code** rendering path in Happy UI. Past failures we are explicitly avoiding:

Forbidden changes — touching ANY of these is automatic fail:

- **Claude Code rendering paths** in `packages/happy-app/`: `ToolView.tsx` Claude-tool branches, `knownTools.tsx` Claude-tool entries, `views/{Bash,Read,Edit,Write,Grep,Glob,WebSearch,Task,TodoWrite,...}View.tsx` (everything that is NOT `Codex*View.tsx`). Edits to shared files (`ToolView.tsx`, `ToolFullView.tsx`, `knownTools.tsx`, `codexToolRendering.ts`) ARE allowed only if the diff demonstrably affects Codex paths only — verified by a regression-guard test that asserts Claude tool rendering is unchanged.
- **Shared protocol** types in `packages/happy-wire/src/sessionProtocol.ts` and `packages/happy-app/sources/sync/typesRaw.ts`: existing fields and existing parser branches MUST NOT change behavior for non-Codex envelopes. New fields are allowed only if they are additive and Codex-specific.
- **Shared reducers** in `packages/happy-app/sources/sync/reducer/*`: same rule — additive Codex-specific branches only; no change to existing message handling order, dedup logic, or sidebar attribution that Claude Code depends on.
- **Production paths**: `/root/happy/`, `/root/.happy/`, `/root/.happy-jade/`, `happy-server`, production web image `happy-app:message-fixes`, `/usr/bin/happy*`, `/usr/lib/node_modules/happy*`.
- **Daemon binaries other than dev**: do NOT restart `happy-daemon.service` or `happy-daemon-jade.service`. Only `happy-daemon-dev.service` is in scope, and even that is REQUEST → user (S4), not a subagent action.
- **Hook configuration**: `~/.claude/hooks/*`, `~/.codex/hooks.json`, `.claude/settings.json` (anywhere). Same rule for `pretool-bash-safety.sh`, `pretool-orchestrator-gate.py`, `pretool-block-production.sh`, `pretool-block-production-files.sh`, `pretool-orchestrator-prompt-purity.py`, and any `pretool-*` / `posttool-*` / `stop-*` script. The hooks failed once (Codex audit re-created `stop-workflow-enforce.py`); do NOT touch them in this cycle.
- **Database / Docker daemon / Cloudflare tunnel / systemd unit files**: out of scope.
- **CLI global install path**: NEVER `npm install -g`, NEVER edit `/usr/bin/happy*`, NEVER call `/usr/bin/happy` (auto-upgrade trigger). Dev daemon already runs `/usr/bin/happy-dev` which symlinks into the worktree; no global install is needed for any S1–S7 step.

Out of scope for this cycle (do NOT expand into these unless surfaced as a separate cycle):
- Cleaning up the 139 uncommitted files / making any commit. Cleanup happens after S7 verifies green.
- New features, refactors, performance work, or "while I'm here" cleanup not on the S1–S7 list.
- Test additions outside the regression-guard set required for the changes above.

---

## Hard Rules Relevant to Orchestrator

Each of the four must be verified live, on both desktop (≥1280×720) and mobile (390×844) viewports of `https://dev.life-ai.app` or `http://localhost:8097`. Code review, grep, curl, or fixture-only test pass is **not** sufficient evidence — every requirement needs a live screenshot pair as evidence. Per CLAUDE.md, production URLs and ports are off-limits.

---

## Agent Relevance Analysis

| Agent | Relevant | Reason |
|-------|----------|--------|
| ui-specialist | no | No visual design briefs in spec; rendering verification only, no design creation |
| ba | yes | Section 5 (User's Acceptance Criterion) explicitly assigned to BA |
| dev | yes | Sections 2 and 3 assigned to Dev; implements S1, S5, S6, S-BUILD, S2, S3, and outputs S4 REQUEST |
| qa | yes | Sections 4, 6, 7 assigned to QA; runs S7 4x2 live verification matrix |
| pm | yes (supervisory) | Section 1 (Before) and Section 8 (Attention Notes) assigned to PM/PM-Retro |
| architect | no | No structural/dependency/scalability work in spec |
| product-owner | no | No business-level scope definitions; this is a runtime-closure cycle |
| user | yes | S4 explicitly requires REQUEST -> user for daemon restart; S6 scope decision |
| cleaner | no | Cleanup explicitly out of scope ("Cleaning up the 139 uncommitted files" deferred) |
| cleanliness-inspector | no | Same as cleaner -- no file-organization audit in scope |
| git-edge-case-analyst | no | No git-history analysis required |
| prompt-inspector | no | Not invoked by spec |
| rule-inspector | no | Not invoked by spec |
| style-inspector | no | Not invoked by spec |
| test-executor | no | QA owns test execution, no separate test-executor role in spec |
| test-validator | no | QA owns test validation, no separate test-validator role in spec |

## Views Created

- ba.md
- dev.md
- qa.md
- pm.md
- user.md
- orchestrator.md

## Monolith Sections

## Section 1: Before

## Section 2: What Was Attempted

## Section 3: What Was Changed

## Section 4: Current State

## Section 5: User's Acceptance Criterion

## Section 6: Why Not Met

## Section 7: What Must Be Done

## Section 8: Attention Notes
