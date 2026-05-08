<!-- AUTO-GENERATED VIEW for pm | source: docs/dev/specs/spec-20260502-162334.md | extracted: 2026-05-02T19:56:02Z -->

# pm view of spec-20260502-162334

**Monolith**: docs/dev/specs/spec-20260502-162334.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> ## Section 1: Before

> <!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->

> ## Section 8: Attention Notes

> <!-- WHO WRITES: PM-Retro -->

---

# Spec: Codex 4-fix runtime closure — make declared fixes actually visible to user

**Pipeline**: <pipeline_index>
**Session**: <session_id>
**Created**: 2026-05-02T16:23:34+00:00

---

## Section 1: Before

<!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->
<!-- WHAT: Screenshot path + text description of the current state BEFORE any fix attempt. -->
<!-- This establishes the baseline so later cycles can compare. -->

### Cycle 1

Codex audit (2026-04-29) of /dev/shm/dev-workspace/happy-dev (139 uncommitted files) found that the four self-reported fix groups exist at the source level and pass focused tests + typecheck, but none of them are visible to the user in the live dev runtime. Concrete baseline:

- **Source layer**: typecheck passes for `happy`, `happy-app`, `@slopus/happy-wire`. Focused tests pass (CLI 33/33, app 70/70 + 454/511 full, wire 10/10).
- **Dev daemon process**: started 2026-04-25 03:29 (per `daemon.state.json`), pid 275490, predates all 4-28/4-29 source changes. Existing daemon-managed Codex sessions therefore load stale CLI code.
- **Dev web container image**: `happy-app:dev`, image_id `sha256:33d0b8f6863e...`, created 2026-04-28T13:42:23Z. Multiple app source files have mtime > 2026-04-28T13:42 (e.g. `codexToolRendering.ts` 2026-04-29 08:26, `ToolView.tsx` / `ToolFullView.tsx` / `CodexParallelView.tsx` 2026-04-28 17:39, `codex-render-fixtures-data.ts` newer than image). Live UI does not contain the latest renderer changes.
- **Protocol gate**: `packages/happy-cli/src/codex/codexAppServerClient.ts:802` still has `experimentalRawEvents: false`. New Codex renderers (CodexBashView / CodexSubagentView / CodexParallelView / CodexPatchView / CodexDiffView / CodexAttachmentView / CodexPlanView) depend on raw item events that this flag controls, so they have no data to render even if deployed.
- **Scope policy**: `packages/happy-app/sources/utils/codexToolRendering.ts:26-28` returns `hasSpecializedView`, which prevents Grep/Search leakage but also hides Codex generic / unknown / resource tool results that the fixture file `codex-render-fixtures-data.ts:140-151,273-283` still expects to render inline.
- **MCP elicitation handler**: `codexAppServerClient.ts:1250-1252` (gate `isMcpToolApprovalElicitation`) and `:1294-1299` (called from `handleMcpElicitationRequest`, which sends `{action: 'cancel'}` when the gate rejects) only accept `mode === 'form' && _meta?.codex_approval_kind === 'mcp_tool_call'`; other Playwright MCP elicitation shapes still fall through to cancel.
- **Attachment path**: `packages/happy-cli/src/codex/runCodex.ts:72-126` downloads attachments to `join(tmpdir(), 'happy-attachments')` and only converts images (`mimeType.startsWith('image/')`, lines 119-123) to `{type: 'localImage', path}` input items; non-image files are inserted as path text into the prompt (lines 113-115), which is not equivalent to the model receiving file contents.
- **QA history**: `docs/dev/qa-report-20260428-063343-codex-rendering.json`, `-iter1-live-rerun.json`, `-iter2-live-rerun.json` are all `verdict: fail` — desktop/mobile live matrix never closed (patch diff, parallel tools, unknown future tool inline still failing in iter2).
- **User verdict**: "彻底没有实现需求" — the four fix groups did not deliver because nothing the user can see has changed.

Working tree at spec time: `git status` reports 139 uncommitted files, including transient po-reset*.md, scripts/{deploy,rollback}.sh, and many docs/dev/{architect,ba,qa,evidence}-* artifacts that should not block this cycle.

---

## Section 8: Attention Notes

<!-- WHO WRITES: PM-Retro -->
<!-- WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session. -->
<!-- Example: "This file is imported by 12 components -- changes here cascade widely" -->

_Not yet populated._
