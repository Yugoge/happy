# QA Amendment — Cycle 1 — spec-20260502-162334

> Authored by QA on 2026-05-03 in lieu of direct Section 4/6/7 edits to the monolith spec.
> The QA tool-policy restricts QA writes to `docs/dev/specs/<spec-id>/qa-*`; this addendum captures Section 4 / 6 / 7 content for the cycle.

---

## Section 4: Current State — Cycle 1 (QA-measured)

QA executed S7 live verification on dev.life-ai.app (web) using the default-account credentials (`cmi5mv9eh00wzpg14ph73jj3n`). Two live Codex sessions were created: `cmopyidhb1j6fqj15s1k5w657` (default permissions, aborted by misclick on alert icon) and `cmopymd1n1jfxqj15f9s254qa` (safe-yolo, completed two Bash exec turns). One live Claude session (`cmopysvha1js1qj157augj083`) was created for D2 + D4 regression guards. The dev fixtures route `/dev/codex-render-fixtures` was used to verify the full set of seven specialized Codex renderers + two non-specialized Codex tools — the page text confirms "Inline cards use the same ToolView and MessageView components as sessions; detail uses ToolFullView; sidebar uses the same RightSidebar content renderer."

**Measured values**:

- **S-BUILD**: `dist/runCodex-D-BNGnwz.mjs` mtime `2026-05-03 10:08:39` > `src/codex/codexAppServerClient.ts` mtime `2026-05-03 10:05:18`; `experimentalRawEvents: true` count = 1; `experimentalRawEvents: false` count = 0.
- **S3**: `happy-app:dev` image `427c21be10ab` created `2026-05-03T10:13:38Z`; `curl -sS http://localhost:8097/` → HTTP 200 `<!DOCTYPE html>`.
- **S4 (skipped per orchestrator-recorded justification)**: Daemon `pid 275490` started `2026-04-25 03:29:03` is unchanged. Daemon cmdline = `node --no-warnings --no-deprecation /dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs daemon start-sync` (verified via `/proc/275490/cmdline`). Codex children spawned by the daemon today (PID 3546255 at 16:00:04 and PID 3572517 at 16:03:10) loaded the new dist on launch — see `spawnHappyCLI.ts:72,104`. New Codex children are running new code; existing pre-rebuild Codex sessions are stale and were not used for verification.
- **S1 verified at runtime**: 14 `rawResponseItem/completed` notifications appear in `/root/.happy-dev/logs/2026-05-03-16-03-10-pid-3572517.log` for the live Codex thread, demonstrating that `experimentalRawEvents: true` is in effect on the wire.
- **D1 evidence**:
  - Log line 287 of `/root/.happy-dev/logs/2026-05-03-16-03-10-pid-3572517.log`: `[Codex] Permission request sent for tool: mcp__happy__change_title (mcp:happy:0)`. Proves `mcpServer/elicitation/request` is **received and routed through the approval handler** by the post-S5 gate.
  - `grep "Unknown server request" /root/.happy-dev/logs/2026-05-03-16*.log` → no matches anywhere today.
  - `grep "user rejected MCP tool call" /root/.happy-dev/logs/2026-05-03-16*.log` → no matches anywhere today.
  - **Coverage gap**: dev daemon does not have Playwright-MCP configured. The exercised MCP tool was `mcp__happy__change_title`, NOT a Playwright-MCP tool. Spec D1 names Playwright MCP specifically; the gate codepath is proven engaged but the original failing target is not exercised in this cycle.
- **D2 evidence**:
  - Live session: `D2-codex-bash-rendered-desktop.png` + `D2-codex-bash-rendered-mobile.png` show TWO Codex Bash cards with `Terminal` header + `$ /bin/bash -lc 'echo HELLO_FROM_CODEX_BASH_2'` command line + `HELLO_FROM_CODEX_BASH_2` stdout + `exit 0`. `D2-codex-bash-second-call-desktop.png` shows a second call with the same fields. Detail/sidebar view captured in `D2-codex-bash-detail-desktop.png` shows `CodexBash` header with same labelled fields. Zero `[object Object]`. No duplication.
  - Fixtures (`/dev/codex-render-fixtures`, screenshots `D2-D4-fixtures-all-renderers-desktop.png`, `D2-D4-fixtures-scrolled-non-specialized.png`, `D2-D4-fixtures-non-spec-and-future-tool.png`, `D2-fixtures-parallel-and-image-mobile.png`, `D2-fixtures-patch-plan-mobile.png`, `D2-D4-fixtures-non-specialized-mobile.png`) confirm all seven specialized renderers render correctly on both desktop AND mobile: Markdown, Terminal, Patch (Update file example.ts), Plan (2 steps with status), Parallel (multi_tool_use.parallel with child tools functions.exec_command + mcp__resources__read + Output JSON), View image (functions.view_image with plot.png preview, 640×480, 2048 bytes), and the two non-specialized Codex tools List MCP resources (functions.list_mcp_resources) and functions.future_tool. The fixtures route description text affirms it uses the same components as live sessions (ToolView, MessageView, ToolFullView, RightSidebar).
- **D3 evidence**:
  - Codex session input row (desktop `D3-codex-input-yolo.png`, mobile `D3-codex-input-no-file-button-mobile.png`): icons = gear, alert, branch (left), image + send (right). NO paperclip. Both viewports.
  - Claude session input row (desktop `D3-claude-input-row-desktop.png` and `D2-D4-claude-regression-desktop.png`, mobile `D2-D4-claude-regression-mobile.png`): icons = gear, alert, branch (left), paperclip + image + send (right). Paperclip clearly visible. Both viewports.
  - **Coverage gap**: image-attachment-flows-to-model-and-model-quotes-content was not tested live. Path-b acceptance per dev report is the negative proof (file-button hidden in Codex sessions, image-button visible) — both proven.
- **D4 evidence**:
  - Forward fix (Codex generic/unknown/resource render INLINE): fixtures show `functions.list_mcp_resources` and `functions.future_tool` cards rendering inline with INPUT + OUTPUT/ERROR JSON visible — desktop AND mobile. These are non-specialized Codex tools with `hasSpecializedView=false`; they render only because the new `isCodexSourceTool` whitelist matches `functions.*` prefix.
  - Regression guard (Claude generic tools COLLAPSED on main transcript): live Claude session (`D2-D4-claude-regression-desktop.png` and `-mobile.png`) shows Bash card rendered inline with full `$ echo CLAUDE_BASH_TEST` + `CLAUDE_BASH_TEST` stdout, while Grep displays only a one-line summary `grep(pattern: package.json)` with NO inline output. Bash unchanged; Grep collapsed.
  - **Minor coverage gap**: only Grep triggered live in regression session, not Glob/WebSearch/ToolSearch. Tests in `codexToolRendering.test.ts:162-220` cover all four; live coverage is partial.
- **Codex consultation**: gpt-5.5 xhigh consult at `docs/dev/qa-codex-consensus-20260502-162334.txt`. Verdict: CONDITIONAL/PARTIAL PASS. Initial concerns (B) and (C) addressed by fixtures evidence; (A) and (D) remain documented gaps below.
- **Hard prohibitions check**: Playwright navigation only to dev.life-ai.app and localhost:8097. No `/usr/bin/happy` or `npm install -g`. No daemon restart by subagent. No edits to non-Codex `*View.tsx` files (dev report `files_modified` confirms only AgentInput.tsx + 2 codex-cli files + codexToolRendering.ts/.test.ts).

---

## Section 6: Why Not Met — Cycle 1 (per remaining gaps)

Top-line verdict is **PASS-WITH-DOCUMENTED-GAPS** (warning), not strict spec-text PASS. Three documented gaps:

1. **D1 Playwright-MCP coverage gap (environmental)**:
   - Spec text: "MCP elicitation — Codex calling Playwright MCP must no longer report `user rejected MCP tool call`, and must no longer log `Unknown server request: mcpServer/elicitation/request`. Verified by triggering a real Playwright MCP call from a Codex session in dev UI."
   - Measured: Codex called `mcp__happy__change_title` (the happy MCP). The S5 gate accepted that elicitation and routed through the approval handler. Logs show no "Unknown server request" or "user rejected MCP tool call" anywhere.
   - Gap: dev daemon does not have Playwright MCP server configured for the dev account, so the original failing target (Playwright MCP) was not exercised. The gate codepath is proven engaged for one MCP shape (form-mode `mcpServer/elicitation/request`); the spec literally names Playwright as the verification target.

2. **D3 image-attachment-to-model proof not exercised**:
   - Spec text (path-b path): "scope the user-facing requirement to 'images only' AND document that explicitly in Section 3 of this spec AND make the user-visible message UI surface the limitation". Image-only acceptance accepted.
   - Measured: paperclip-hidden + image-button-visible verified on Codex (desktop + mobile); paperclip-visible verified on Claude. AgentInput.tsx isCodex gate works.
   - Gap: did not upload an image and confirm "model reply quotes image content". Path-b acceptance is satisfied by the negative proof per dev report `s6_decision`, but a positive image-flows-to-model live test would close the loop.

3. **D4 regression guard partial coverage**:
   - Spec text: "Claude Code Grep / Glob / WebSearch / ToolSearch cards from D2's session must remain collapsed on main transcript".
   - Measured: live Grep verified collapsed.
   - Gap: live Glob, live WebSearch, live ToolSearch each individually verified collapsed. Unit tests in `codexToolRendering.test.ts:162-220` cover all four; live coverage is one of four.

Codex consult flagged these explicitly:
- (A) "D1 partial/pass-with-environment gap, not full strict pass" — environment cannot exercise Playwright-MCP.
- (D) "D3 image-to-model path remains unproven" + "D4 regression only exercised Grep".

---

## Section 7: What Must Be Done — Cycle 1 (next-cycle prescriptions)

If a follow-up cycle is opened to close the documented gaps, prescriptive next steps:

1. **D1 Playwright-MCP closure**:
   - **File / config**: dev daemon (`/root/.happy-dev/`) does not currently have Playwright MCP configured. The dev account's Codex MCP servers list must include `playwright-mcp-stealth` or equivalent. Either (a) the user configures Playwright MCP for the dev daemon and reruns S7 with a Codex prompt that explicitly invokes a Playwright MCP tool (e.g. "Use the Playwright MCP browser_navigate tool on https://example.com and report the page title"), or (b) the spec acceptance is amended to accept any MCP server's `mcpServer/elicitation/request` as proof of S5 gate engagement (since the gate is server-agnostic at the JSON-RPC layer).
   - **Acceptance**: Codex log `[Codex] Permission request sent for tool: mcp__playwright__<some_tool>` AND user-approves AND model receives the result text.

2. **D3 image-flow-to-model closure**:
   - **File / pipeline**: `runCodex.ts:119-122` already converts image attachments into `{type: 'localImage', path}` input items. To close D3 fully, run a live test: open Codex session in dev UI, click image attachment icon, upload a small image (e.g. screenshot of a known text), send "Please describe what you see in this image". Acceptance: model reply quotes content visible in the image (not just the path string).

3. **D4 live Glob/WebSearch/ToolSearch coverage**:
   - **Action**: in a Claude dev session, send a prompt that triggers each tool independently (`Use Glob to find package.json files in /tmp`, `Use WebSearch to find ...`, `Use ToolSearch ...`). Verify each tool card stays collapsed on the main transcript (no inline input/output). Capture screenshots labelled per-tool.

None of these gaps blocks the dev work currently committed. The `isCodexSourceTool` whitelist + the S5 gate relaxation + the AgentInput.tsx isCodex gate + the experimentalRawEvents flag flip are all proven engaged at runtime. The gaps are coverage-shape gaps, not implementation defects.

---

## Verdict

`qa.status = warning` — implementation passes the spec's intent (the four declared fixes are wired through to the live runtime and visible to the user), with three documented coverage gaps that warrant follow-up but do not invalidate the current cycle's runtime closure work.
