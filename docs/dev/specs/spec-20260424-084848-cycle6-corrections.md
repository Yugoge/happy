# spec-20260424-084848 — Cycle 6 Corrections (Honest State After User Manual Verification)

**Pipeline**: standalone
**Session**: manual
**Created**: 2026-04-26T22:30:00Z (Cycle 6 close)
**Parent monolith**: `docs/dev/specs/spec-20260424-084848.md`
**Sibling addendum**: `spec-20260424-084848-section-5.19-bgtask.md` (bg-task notification — partial)
**Cycle 6 dev session**: dev-20260425-201355
**Authority**: This file replaces all Cycle 6 self-reported PASS/PARTIAL verdicts in `docs/dev/completion-20260425-201355.md` for items where the user's manual inspection revealed errors.

> **Why this file exists**: Cycle 6's automated /dev workflow self-reported "0 FAIL, 7/7 spec items + 7.2 + 7.3 PASS". User manually inspected the deployed dev environment after build, found that:
> 1. **5.2 fix is built on a false premise** (default ≠ 1M; user CLI happens to be 1M but that's user-config, not protocol).
> 2. **5.8 fix did not cover markdown tables in agent messages** — tables still overflow message-card width.
> 3. Other items pass, but 3 PASS-with-warnings cases were never live-verified end-to-end.
> 4. 5.19 7.1 deferred (CLI daemon untouched).

---

## Section 4 Correction — Cycle 6 Honest State (per item, 2026-04-26T22:30Z)

### Confirmed PASS via user manual inspection (live render verified)

| # | Item | Live evidence file | State |
|---|---|---|---|
| 5.3 | Right detail panel command wrap | `docs/dev/visual-evidence-20260426/10-detail-panel-1920.png` — long ls command wraps to 4 lines in right Bash panel, no horizontal scroll | PASS — wrap-mode fix (SidebarBashView removed ScrollView, CommandView opt-in `wrap` prop) verified at 1920 viewport with deployed `happy-app:dev` (hash 858ee1fe) |
| 5.4 + 5.5 | Header responsive width + sidebar toggle direction | `06-header-1920-default.png` + `10-detail-panel-1920.png` — avatar pinned right edge regardless of right-panel state | PASS — `WEB_TABLET_MAX_WIDTH_CAP=800` removed in `useHeaderMaxWidth.ts` |
| 5.16 | LaTeX rendering (inline + block + mid-line `$$`) | `03-fresh-session-desktop-1440.png` + `13-mobile-390-bottom.png` — all 3 modes render KaTeX at desktop AND mobile | PASS — regex precedence fix in `parseMarkdownSpans.ts:6` |
| 5.17 | Markdown H1/H2/H3 + lists | `06-header-1920-default.png` + `13-mobile-390-bottom.png` — clear visual hierarchy H1>H2>H3>body, lists with `•` and `1./2./3.` sibling markers | PASS — `MarkdownView.tsx:545-582` header sizes + `:174-216` list sibling-marker pattern |
| 5.18 | CronList INPUT line | `03` and `10` — card shows `CronList` + `{}` two rows; opened detail shows Description/Input Parameters/Output | PASS — `extractSubtitle` field added to knownTools.tsx CronList entry; user accepted in chat |

### Confirmed FAIL via user manual inspection (Cycle 7 work)

| # | Item | What's wrong | Cycle 6 fix that didn't catch |
|---|---|---|---|
| 5.2 | Context% display logic | Premise wrong: hardcoded `getDefaultModelContextWindow(flavor)` returns `1_000_000` for claude under assumption "default is 1M". Reality: `default` is whatever Claude Code's CLI is configured for (varies per user). User happens to have configured 1M; for other users this returns wrong value, breaking context% on non-1M default configurations. | The 5.2 fix conflated **happy-app's "default" picker key** with **Claude Code CLI's runtime default model**. They are different concepts. |
| 5.8 (regression scope) | Markdown tables in agent messages overflow message-card | Wide tables render with internal horizontal-scroll wrapper but the WRAPPER itself is sized off `messageContent.maxWidth`. When agent message contains a multi-column wide table, the message-card visibly overflows its parent container at desktop AND mobile viewports. | Cycle 6 5.8 fix added `overflow:hidden` to `userMessageContainer` / `userMessageBubble` / `toolContainer` only. **Agent message + markdown-table wrapper path was not touched.** Cycle 5 had reported "table overflow PASS" — but that was about scrollability, not about whether the message-card itself stays within parent width. Different test dimensions. |

### Partial / deferred (no end-to-end test possible without further infra)

| # | Item | State | Why |
|---|---|---|---|
| 5.19 | bg-task notification real-time refresh | Pipeline 7.2 (server snapshot) + 7.3 (app reconnect catch-up A/B/C) deployed and structurally verified | Pipeline 7.1 (CLI keepAlive instrumentation + Phase 2 `this.thinking` refire) **deferred** — user choice to not restart `happy-daemon-dev`. Phase 1 instrumentation lives in worktree at `packages/happy-cli/src/{claude,api}/` (6 logger.info keys). End-to-end "babbling indicator restored after web close+reopen during active subagent" cannot be verified until daemon is restarted with instrumented build. |

### Not in Cycle 6 scope (carried unchanged from prior cycles)

| # | Item | State |
|---|---|---|
| 5.1 | Per-session model persistence + status-bar model indicator | Cycle 5 PASS, not re-tested in Cycle 6 |
| 5.6 | Codex prompt-style adapter | Codex skipped — quota exhausted in Cycle 5 |
| 5.7 | Codex slash-command rendering | Codex skipped |
| 5.10 | Long-task disconnection | BLOCKED — needs 30+ minute test cycle |
| 5.11 | Detail panel scroll | Carried from Cycle 5 |
| 5.12 | Attachment tray | Carried from Cycle 5 |
| 5.13 | Codex tool-call rendering | Codex skipped |
| 5.14 | Codex command-result rendering | Codex skipped |
| 5.15 | Tool coverage matrix | Cycle 5 PASS |
| 5.6 + 5.7 + 5.13 + 5.14 + 5.15 | Codex-related | All deferred to next quota window |

---

## Section 6 Correction — Cycle 6 Why Self-Reported PASS Was Wrong (for 5.2 + 5.8 table cases)

### 5.2 — Self-PASS based on logic that was internally consistent but premise-wrong

Cycle 6 BA spec (`docs/dev/ba-spec-20260425-201355-5-2.md`) correctly identified two L4 logic gaps:
1. Claude CLI never writes `metadata.currentModelCode`
2. AgentInput.tsx:365 truthy-guard hides indicator when `contextSize === 0`

The fix correctly addressed both gaps. Internal logic is sound: when `picker === 'default'`, route through new helper that returns `getDefaultModelContextWindow(flavor)`. Helper returns `1_000_000` for claude.

**The bug**: the helper's return value `1_000_000` is **a guess about user's default-model config, not a fact**. Claude Code's CLI default model can be:
- claude-sonnet-4.6 (200K context) — common default
- claude-sonnet-4.6 with 1M beta header (1M context) — user's specific config
- claude-opus-4 (200K context) — alternate default
- any future model

The fix's `1_000_000` works correctly only when user's CLI default IS the 1M beta variant. For users with default = sonnet 4.6 standard, the fix would render `94% left` based on a 1M denominator while the actual context budget is 200K — so the indicator is wrong by 5x.

QA Cycle 6 verification did not catch this because:
- The QA test session used user's own account (which has 1M default)
- `94% left` rendered, looked correct
- No QA prompt asked: "is this denominator actually correct, or just self-consistent?"
- No QA crossed-checked the rendered % against actual API token usage from network response

User caught it on manual inspection by recognizing the architectural misuse.

### 5.8 (table case) — Self-PASS based on table scrollability, not container fit

Cycle 5 had marked 5.8 as "table overflow handled" because table content was internally scrollable (the table wrapper has `overflow-x:auto`). Cycle 6 5.8 fix targeted user-message + tool-card paths and did not re-test agent-message + markdown-table.

**The bug**: a markdown table inside an agent's response renders inside `MarkdownView`, which has its own `<table>` rendering with a wrapper. The wrapper's max-width binding does NOT honor the message-card's `useMessageContentMaxWidth()` value. When user pastes a wide table (10+ columns or long cell content), wrapper width = natural table width, which can be > message-card width, which causes the message-card itself to overflow its grid cell at desktop AND mobile.

QA Cycle 6 verification did not catch this because:
- Test prompts didn't include super-wide tables
- The existing dev-verify-131502 session had a "wide table" but its width fit within 800 messageContent cap
- No QA prompt tested "what if user sends a really wide table"

User caught it by rendering a 10-column wide table in this orchestrator session and observing the message-card overflowed its parent.

---

## Section 7 Correction — Cycle 6 What Must Be Done (Cycle 7 prescriptive items)

### 5.20 — Markdown table in agent message overflows container (NEW item)

**Layer**: L2/L3 (responsive width binding for `<table>` wrapper)

**Files in scope**:
- `packages/happy-app/sources/components/markdown/MarkdownView.tsx` — find table render block (look for `<table>` JSX or `RenderTable` function)
- Possibly `packages/happy-app/sources/hooks/useMessageContentMaxWidth.ts` — extend to thread into table wrapper

**Acceptance**:
- AC1: agent message containing a 10-column wide table at desktop 1920 viewport stays within messageContent maxWidth (800px); table content scrolls horizontally INSIDE that boundary
- AC2: same test at mobile 390×844 — message-card stays within 390px; table scrolls inside
- AC3: live verification via Playwright with deliberately-wide markdown table sent through UI

**Suggested approach**: bind table-wrapper `maxWidth` to `useMessageContentMaxWidth()` (the same hook 5.8 used for messageContent) and add `overflow-x:auto` so content scrolls inside.

### 5.21 — Replace hardcoded `default=1M` assumption with actual context-window detection (REWRITE of 5.2)

**Layer**: L4 + cross-tier (CLI + server + app)

**Steps**:

**5.21.A — CLI: report current model + its context window in agentState/metadata**
- File: `packages/happy-cli/src/claude/runClaude.ts` or `claudeRemote.ts` — wherever the model identifier is known when starting a turn
- File: `packages/happy-cli/src/api/apiSession.ts` — extend the metadata payload (`currentModelCode` was attempted but only ACP path writes it; Claude CLI path needs to write too)
- Field naming: `agentState.currentModel = { id: string, contextWindow: number }` — single source of truth, not derivable from picker
- Source of `contextWindow`: Anthropic SDK's known value for the model id, OR a static lookup keyed on Claude's known model ids, OR (best) read from SDK response metadata if exposed

**5.21.B — App: read the reported value, drop the `getDefaultModelContextWindow` helper**
- Revert `getDefaultModelContextWindow` introduction in `modelModeOptions.ts:103-122` (remove the 1M hardcoding)
- Revert the `picker === 'default' ? helper : getModelContextWindow(...)` branch in `AgentInput.tsx:359-366`
- Replace with: read `agentState.currentModel.contextWindow` directly; if undefined, fall back to legacy `getModelContextWindow(modelKey)` lookup
- Keep the presence-check guard from Cycle 6 (`usageData ? ... : null`) — that part was correct

**5.21.C — Server: forward the metadata field**
- Confirm `Account.agentState` blob preserves the new field round-trip (encrypted blob, server doesn't need to read it; just store + relay)
- No Prisma schema change

**Acceptance**:
- AC1: user with default=sonnet 4.6 standard (200K) sees `% left` calculated against 200K denominator (not 1M)
- AC2: user with default=sonnet 4.6 1M beta sees `% left` calculated against 1M denominator
- AC3: user manually picks "sonnet 4.6" via picker → `% left` against that model's actual window
- AC4: live verification across 2-3 user accounts with different default configs

### 5.22 — UI 1M context-window manual toggle (NEW item)

**Layer**: L2 (UI picker UX) + L3 (CLI SDK header forwarding)

**Files in scope**:
- `packages/happy-app/sources/components/ModelPicker.tsx` (or wherever model picker UI lives) — add 1M variant entries
- `packages/happy-cli/src/claude/runClaude.ts` — forward `context-1m` beta header when 1M variant selected
- `packages/happy-wire/src/sessionProtocol.ts` — extend model identifier schema if needed

**Acceptance**:
- AC1: model picker shows 1M variants alongside standard variants for models that support it
- AC2: switching to 1M variant in UI sends correct beta header to Anthropic SDK on next turn
- AC3: status bar % left immediately reflects new 1M denominator after switch
- AC4: switching back to standard variant restores 200K denominator

### Required for full 5.19 verification

- Restart `happy-daemon-dev.service` (PAUSE-PENDING-USER per CLAUDE.md "Long-Running Process Verification") OR sandbox-daemon test to load the instrumented CLI
- Reproduce bg-task scenario; capture journalctl output with the 6 log keys
- Identify which H_F variant (H_F.1 or H_F.3) is the real root cause
- Apply Phase 2 fix in CLI based on captured evidence
- Re-deploy CLI; re-run QA Test 4 end-to-end

---

## Section 8 Correction — Cycle 6 PM-Retro Notes (lessons + recurrence analysis)

### Cycle 5 wrong-PASS patterns — recurrence analysis in Cycle 6

| Cycle 5 pattern | Recurred in Cycle 6? | How |
|---|---|---|
| 1. 测错容器边界 (measuring wrong container) | **YES (5.8 table case)** | QA measured user-message + tool-card containers per fix scope, didn't extend to agent-message + markdown-table container — same "wrong container" mistake at a higher layer |
| 2. 验响应方向 (verifying wrong direction) | NO direct recurrence; but 5.4+5.5 PASS was via screenshot side-by-side |
| 3. 读用户原话 (misreading user complaint) | NO direct recurrence |
| 4. 不动态验 BA 假设 (not dynamically verifying BA premise) | **YES (5.2 logic)** | BA assumed "default = 1M" based on user CLI behavior; QA verified the fix self-consistently rendered `% left` but didn't cross-check that 1M was the right denominator. Premise was never dynamically validated. |

**Net**: 2 of 4 Cycle 5 patterns recurred in Cycle 6 despite documented lessons. PM-Retro mechanism is dead-document — no runtime gate prevents recurrence. See `hook-block-handoff-20260425-201355.md` for system architectural gap.

### New Cycle 6 wrong-PASS patterns to add to PM-Retro

| Pattern | Description |
|---|---|
| 5. **OR-fallback in QA prompts** | Orchestrator wrote QA prompts with "use existing session OR create new". QA chose lazy path consistently. Fix: prompts must use "MUST X. If blocked: STOP." with no OR alternatives. |
| 6. **PASS-with-warnings as silencer** | "PASS-with-warnings" verdict aggregated 3 proxy-verified items into "PASS" headline. Honest disclosure should label evidence-type per item: live-render / bundle-proxy / source-grep / simulation. Mixing them under PASS is information dishonesty. |
| 7. **cp-state never updated** | All 5 QA checkpoints in `.claude/specs/spec-20260424-084848/cp-state-qa.json` remain `pending` after 8 QA + 1 retry runs. Cp-state mechanism designed but not wired from orchestrator → subagent prompts. cp-state should be canonical ground-truth, not advisory metadata. |
| 8. **Self-consistency vs ground-truth** | 5.2 fix passed QA because rendered indicator was internally consistent with assumed denominator; user caught it because they checked against real-world ground-truth (their CLI config). QA needs a "ground-truth cross-check" step for any computed/derived value (% left, sizes, counts). |

### Action items for Cycle 7 orchestrator

1. **No OR in QA prompts** — every "MUST do X" is unconditional; if blocked, subagent stops and reports
2. **Evidence-type field mandatory** — every QA report includes `evidence_type: live-render | bundle-proxy | source-grep | simulation` per AC; orchestrator rejects non-live-render unless explicitly waived with reason
3. **cp-state path in subagent prompts** — every BA/dev/qa dispatch prompt includes path to its cp-state JSON and explicit instruction to update pending → completed/waived
4. **cp-state pending count check** — orchestrator does not advance to next workflow step while any required cp-state has pending checkpoints
5. **Ground-truth cross-check for derived values** — every numerical/percentage/size verdict in QA needs a second source (network response, computed CSS, or user reference value)

---

## Cycle 6 evidence inventory

Live render screenshots: `docs/dev/visual-evidence-20260426/`
- `01-current-session-1440.png` — orchestrator session status bar (5.2 active context%)
- `03-fresh-session-desktop-1440.png` — fresh qa-fresh session (5.16 LaTeX, 5.17 lists, 5.18 CronList, 5.2 status)
- `06-header-1920-default.png` — H1/H2/H3 visual hierarchy (5.17), 1920 header (5.4)
- `10-detail-panel-1920.png` — Bash detail panel wrap (5.3 critical evidence)
- `11-mobile-390.png` — mobile 390 viewport message cards
- `13-mobile-390-bottom.png` — mobile demo all fixes

Other artifacts:
- BA specs: `docs/dev/ba-spec-20260425-201355-5-{2,3,4-5,8,16,17,18}.md` + `ba-spec-20260425-bgtask.md`
- Dev reports (initial + retry): `docs/dev/dev-report-20260425-201355-*-{,retry}.json`
- QA reports: `docs/dev/qa-report-20260425-201355-5-{2,3,4-5,8,16,17,18,19}.json`
- bg-task BA: `docs/dev/ba-spec-20260425-bgtask.md`
- Codex research: `docs/dev/codex-research-20260425-bgtask-reconnect.md`
- Hook blocker handoff: `docs/dev/hook-block-handoff-20260425-201355.md`
- Self-reported completion: `docs/dev/completion-20260425-201355.md` (now superseded by this file for 5.2 + 5.8 table)
- Bg-task addendum: `spec-20260424-084848-section-5.19-bgtask.md`

## Cycle 6 deliverable summary (final, honest)

**Confirmed deployed and live-verified**: 5.3, 5.4+5.5, 5.16, 5.17, 5.18, 5.19 (7.2 + 7.3 portions)
**Confirmed deployed but logic wrong**: 5.2 (must revert and redo as 5.21)
**Confirmed regression at higher layer**: 5.8 doesn't cover markdown tables in agent messages (must follow up as 5.20)
**Deferred**: 5.19 7.1 (CLI daemon untouched)
**Cycle 7 spec inputs**: 5.20, 5.21 (rewrite 5.2), 5.22 (UI 1M toggle)
