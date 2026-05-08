<!-- AUTO-GENERATED VIEW for qa | source: docs/dev/specs/spec-20260502-162334.md | extracted: 2026-05-02T19:56:02Z -->

# qa view of spec-20260502-162334

**Monolith**: docs/dev/specs/spec-20260502-162334.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> ## Section 4: Current State

> <!-- WHO WRITES: QA (after each verification) -->

> ## Section 6: Why Not Met

> <!-- WHO WRITES: QA (when verdict is fail) -->

> ## Section 7: What Must Be Done

> <!-- WHO WRITES: QA (on fail) or PM-Retro -->

---

# Spec: Codex 4-fix runtime closure — make declared fixes actually visible to user

## Section 4: Current State

<!-- WHO WRITES: QA (after each verification) -->
<!-- WHAT: Actual measured values -- pixel dimensions, computed CSS, console output, screenshot paths. -->
<!-- This gives the next cycle's Dev concrete data to work with instead of vague "it failed". -->

### Cycle 1

_Not yet populated._

---

## Section 6: Why Not Met

<!-- WHO WRITES: QA (when verdict is fail) -->
<!-- WHAT: Specific gap between measured state (Section 4) and acceptance criterion (Section 5). -->
<!-- Must include evidence: actual value vs expected value. -->

### Cycle 1

_Not yet populated._

---

## Section 7: What Must Be Done

<!-- WHO WRITES: QA (on fail) or PM-Retro -->
<!-- WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action. -->
<!-- Example: "Increase padding from 8px to 16px in Chat.tsx:42" not "fix the padding" -->

### Cycle 1

_Not yet populated._

---

## S7 Live Verification Matrix

- **S7. Live verification matrix** — Depends on S4 user-completion. Per CLAUDE.md "E2E Verification MUST Use Live Browser Content" and "Every UI fix MUST be verified on BOTH desktop AND mobile viewports", produce a 4×2 matrix of screenshot evidence:
  - Send real messages through the dev UI to trigger each tool/event class (do NOT use curl / daemon HTTP / API to spawn sessions or inject content).
  - Each cell: desktop screenshot (default Playwright viewport) + mobile screenshot (`browser_resize` to 390×844 BEFORE navigating).
  - Evidence stored under `docs/dev/evidence/<spec-id>/`.
  - All four requirements must show pass with explicit pass/fail annotation in QA report.
  - Acceptance per requirement:
    - **D1 MCP**: live Codex thread invokes a Playwright MCP tool; observe the call returns a real result, not "user rejected"; tail `/root/.happy-dev/logs/` and confirm no `Unknown server request: mcpServer/elicitation/request`.
    - **D2 Rendering — explicit equivalence checklist (no subjective "align")**: for each Codex tool with a specialized renderer (Bash, Subagent, Parallel, Patch, Diff, Attachment, Plan), the main-transcript card must (i) display the same labelled fields as the Claude Code equivalent (`command`, `stdout`, `stderr`, `result`/`status`, `exit code`); (ii) collapse/expand identically (default-collapsed, click to expand); (iii) contain zero `[object Object]` substrings; (iv) contain no duplicated header or duplicated body block. Sidebar and detail views must show the same fields. To prove "no Claude regression", the same session must also include at least one Claude Code Bash and one Claude Code Grep call — Bash card must still render the same way; Grep card must NOT show input/output on the main transcript.
    - **D3 Attachments**: send an image attachment; the model's reply must reference image content (not just the path). For non-image: behavior matches the S6 decision (either the model quotes file content, or the UI shows the documented limitation).
    - **D4 Scope-leak**: the Claude Code Grep/Glob/WebSearch/ToolSearch cards from D2's session must remain collapsed on the main transcript.

---

## Hard Prohibitions — Regression-Guard Test Mandate (2026-04-25 scope-leak incident)

- **2026-04-25 scope-leak incident (the trigger for this very spec)**: The previous Codex rendering work changed `shouldRenderToolContent` to `hasGenericContent OR hasSpecializedView`, which caused Claude Code's Grep / Glob / WebSearch / ToolSearch tool cards to start leaking input/output on the main transcript. The fix was reverted to `hasSpecializedView`, but that revert hides legitimate Codex generic/unknown tool results too. **S2 in this spec must thread that needle**: any new whitelist condition added to `codexToolRendering.ts:26-28` must be gated on a Codex-source signal, NOT on "has any content". Tests required: a) Grep/Glob/WebSearch/ToolSearch with results — main transcript MUST stay collapsed (regression guard for Claude Code); b) Codex unknown/resource tool with results — main transcript MUST render inline (forward fix for Codex). Live verification on dev UI must include at least one Claude Code Grep call to confirm no leak.

---

## Hard Prohibitions — Production-URL Restriction (2026-03-29)

- **2026-03-29 production-URL incident**: Subagents navigated Playwright to production (`life-ai.app`, `localhost:8090`, `api.life-ai.app`), corrupting production data. All Playwright in this cycle MUST use ONLY `https://dev.life-ai.app` or `http://localhost:8097` and `https://api-dev.life-ai.app`. Hook `pretool-block-production.sh` enforces this; do not attempt to bypass.

---

## Forbidden-Change Audit (QA fails any cycle where Dev's diff touches these)

- **Claude Code rendering paths** in `packages/happy-app/`: `ToolView.tsx` Claude-tool branches, `knownTools.tsx` Claude-tool entries, `views/{Bash,Read,Edit,Write,Grep,Glob,WebSearch,Task,TodoWrite,...}View.tsx` (everything that is NOT `Codex*View.tsx`). Edits to shared files (`ToolView.tsx`, `ToolFullView.tsx`, `knownTools.tsx`, `codexToolRendering.ts`) ARE allowed only if the diff demonstrably affects Codex paths only — verified by a regression-guard test that asserts Claude tool rendering is unchanged.

---

## QA Verification Scope — S1, S2, S6, S-BUILD, S3, S4 Post-Restart

- **S1. Open raw event protocol gate** runtime verification: after S-BUILD, after S4, log/inspect the `thread/start` request payload from `/root/.happy-dev/logs/` for the next Codex thread and confirm the flag is present and `true`. The flag is part of `NewConversationParams` (see `codexAppServerTypes.ts:19-32`) and is sent on the **`thread/start`** RPC (NOT `turn/start`).

- **S2. Fix scope policy whitelist** verification: confirm Grep/Glob/WebSearch/ToolSearch cards stay collapsed on main transcript (regression guard); confirm Codex unknown/resource tool cards render inline. Update / add tests so Grep/Glob/WebSearch/ToolSearch are still proven hidden, while Codex unknown/resource tools are proven shown. Reconcile with `codex-render-fixtures-data.ts` expected strings.

- **S6. Decide attachment file-type semantics** decision-closure judgment criteria: Decision is "closed" only when: chosen path written into Section 3 + user-visible UI behavior implemented + (for path b) user has explicitly confirmed the down-scoping. Whichever path is chosen, image attachments must remain working (continue to flow through `localImage`).

- **S-BUILD** verification: (a) `dist/runCodex-*.mjs` mtime is later than `src/codex/codexAppServerClient.ts` mtime; (b) `grep -c 'experimentalRawEvents: true' dist/runCodex-*.mjs` returns ≥1; (c) `grep -c 'experimentalRawEvents: false' dist/runCodex-*.mjs` returns 0.

- **S3** deploy verification: Image `created` timestamp must be later than every relevant app source mtime; `curl -s http://localhost:8097/ | head -1` must return HTML; production targets (`life-ai.app`, `localhost:8090`, `api.life-ai.app`) must NOT be touched.

- **S4** post-restart verification: (a) `cat /root/.happy-dev/daemon.state.json` shows fresh `startTime`; (b) any new Codex child process spawned by the new daemon uses `/dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs` (verify by inspecting `daemonLogPath`); (c) live dev sessions can still be created via the UI.
