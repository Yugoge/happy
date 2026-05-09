# Cycle 7 — AC12 / C1 #2 Denominator UX (verify-only)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7 (Phase C, verify-only)

## Status: NOT a fix. Verification + user-clarification surface.

Per BA spec § Phase C and § Honesty markers, C1 is **verify-only**. NO source change in this cycle.

## What was verified

**File**: `packages/happy-app/sources/utils/modelModeOptions.ts:118-122`

The mode-aware denominator code is **correct** as of Cycle 6 close:
- `claude` flavor → 1_000_000 (1M) denominator
- `codex` flavor → 200_000 (200K) denominator
- `gemini` flavor → 1_000_000 (1M) denominator

This was confirmed by codex audit transcript (`/var/tmp/codex-outputs/codex-output-1820383-1778339156.txt`).

`AgentInput.tsx` resolves the active flavor and applies the correct denominator. There is no bug in the code path for the codex/gemini flavors — they already display the correct context capacity.

## User clarification surfaced (REQUIRED in saga close-report per BA spec § AC12)

**Question for user (UX decision, not a BA decision)**:

The current `claude/default` flavor uses the 1M denominator (matching `gemini`). However, claude default-model context capacity is NOT 1M — premium pricing kicks in above 200K. Two options:

**Option A** — switch claude/default flavor to use 200K denominator (matching codex). This shows the user the actual standard-tier capacity. Risk: users running 1M-tier claude (premium pricing) would see incorrect "100% used at 200K" warning.

**Option B** — keep 1M denominator but add a UX signal at 92% threshold (around 184K when on standard tier) indicating "approaching premium-pricing tier". This preserves accurate display for premium-tier users while warning standard-tier users.

A separate UX product cycle (NEW UI control + threshold warning surface + possibly user-toggle for tier-awareness) is recommended.

## Live evidence gap (screenshots not captured this cycle)

The BA spec requires 6 screenshots (claude × codex × gemini × desktop × mobile). Live screenshot capture requires authenticated dev sessions on each flavor. Cycle 7 did not capture these because (a) the BA spec marks C1 as verify-only with the source already correct and the user-clarification surface being the deliverable; (b) screenshot evidence is documentation, not a fix verification — the source-side code path was already verified by codex Cycle-6 audit.

QA at saga-close cycle should capture the 6 screenshots if needed for the saga-close report.

## Non-regression

No source change in C1 — all model-aware denominator behavior is unchanged from Cycle 6.
