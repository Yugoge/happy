<!-- AUTO-GENERATED VIEW for ba | source: docs/dev/specs/spec-20260502-162334.md | extracted: 2026-05-02T19:56:02Z -->

# ba view of spec-20260502-162334

**Monolith**: docs/dev/specs/spec-20260502-162334.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> ## Section 5: User's Acceptance Criterion

> <!-- WHO WRITES: BA (on first analysis) -->

---

# Spec: Codex 4-fix runtime closure — make declared fixes actually visible to user

---

## Section 5: User's Acceptance Criterion

<!-- WHO WRITES: BA (on first analysis) -->
<!-- WHAT: Verbatim quote from user's requirement or focus string. -->
<!-- This is the single source of truth for what "done" means. Do not paraphrase. -->

The four fix groups Codex completed over the past few days must actually become visible to the user in the live dev runtime. The user's verdict — "彻底没有实现需求" — must be invalidated by closing the source ↔ runtime ↔ live-UI loop for each of the four requirements:

1. **MCP elicitation** — Codex calling Playwright MCP must no longer report `user rejected MCP tool call`, and must no longer log `Unknown server request: mcpServer/elicitation/request`. Verified by triggering a real Playwright MCP call from a Codex session in dev UI.
2. **Codex tool rendering** — In Happy UI (dev), Codex tool cards on the main transcript must show `command`, `stdout`, `stderr`, `result`, and `status` / `exit code` for the tools that have specialized renderers (Bash, Subagent, Parallel, Patch, Diff, Attachment, Plan). Detail and sidebar views must show the same information without `[object Object]` and without duplication. Behavior must align with how Claude Code renders these on the same screens.
3. **Codex attachments** — When the user attaches an image (and a non-image file) to a Codex session, the model's reply must demonstrate that it received the content (not just a path). At minimum: image attachments must reach the model as `localImage` input items; non-image file behavior must be either fully implemented or explicitly out of scope (decision documented).
4. **Generic tool scope-leak** — Generic Claude tools without specialized renderers (Grep, Glob, WebSearch, ToolSearch) must NOT show input/output on the main transcript. At the same time, Codex generic / unknown / resource tools must NOT be hidden as collateral damage — they should still render their result inline as the fixture file expects.

Each of the four must be verified live, on both desktop (≥1280×720) and mobile (390×844) viewports of `https://dev.life-ai.app` or `http://localhost:8097`. Code review, grep, curl, or fixture-only test pass is **not** sufficient evidence — every requirement needs a live screenshot pair as evidence. Per CLAUDE.md, production URLs and ports are off-limits.

The action plan to satisfy this acceptance criterion (numbered S1–S7) is the implementation contract. **Dependency order is mandatory** — see the dependency graph below; a step's verification cannot start until all its predecessors are complete:

```
S1 (CLI source) ─┐
S5 (CLI source) ─┼─→ S-BUILD (CLI dev build) ─→ S4 (REQUEST → user; PAUSE)
S6 (CLI source) ─┘                                   │
S2 (App source) ──────→ S3 (web image rebuild) ──────┴─→ S7 (QA live matrix)
```

S4 is a **PAUSE-PENDING-USER** boundary: the dev subagent finishes S1+S5+S6+S-BUILD and S2+S3, then outputs the S4 REQUEST and STOPS. The /dev orchestrator marks the cycle as `awaiting-user`. S7 cannot start until the user reports back that the S4 SOP completed successfully.

### Hard Prohibitions (NON-NEGOTIABLE — violation = automatic fail and rollback)

The four fixes in this spec are scoped to the **Codex** rendering path. They MUST NOT regress, alter, or visibly affect the **Claude Code** rendering path in Happy UI. Past failures we are explicitly avoiding:

Forbidden changes — touching ANY of these is automatic fail:

- **Shared protocol** types in `packages/happy-wire/src/sessionProtocol.ts` and `packages/happy-app/sources/sync/typesRaw.ts`: existing fields and existing parser branches MUST NOT change behavior for non-Codex envelopes. New fields are allowed only if they are additive and Codex-specific.
- **Shared reducers** in `packages/happy-app/sources/sync/reducer/*`: same rule — additive Codex-specific branches only; no change to existing message handling order, dedup logic, or sidebar attribution that Claude Code depends on.

Out of scope for this cycle (do NOT expand into these unless surfaced as a separate cycle):
- Cleaning up the 139 uncommitted files / making any commit. Cleanup happens after S7 verifies green.
- New features, refactors, performance work, or "while I'm here" cleanup not on the S1–S7 list.
- Test additions outside the regression-guard set required for the changes above.
