# Cycle 7 — AC14 / C3 #3 Manual context capacity toggle (record-only)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7 (Phase C, record-only)

## Status: NOT a fix. Captured user request + recommendation for separate product cycle.

Per BA spec § Phase C and § Won't Have W3, C3 is **record-only**. NO source change in this cycle.

## User §5.2 quote 4 (verbatim)

From the saga spec `docs/dev/specs/spec-20260506-203755.md` user-feedback section, quote 4:

> The user requested a manual context capacity toggle so that they can switch between standard-tier (200K) and premium-tier (1M) capacities at will, without changing the underlying model. The current AgentInput model-switch UI changes the model entirely (e.g., claude-opus-4-7 → claude-sonnet-4-7) — it does NOT toggle the capacity within a model.

## Existing AgentInput model-switch UI is INADEQUATE substitute

The model-switch UI changes the model entirely, not the capacity within a model. A user wanting to bump claude-opus-4-7 from standard 200K capacity to premium 1M capacity has no UI affordance for this today.

## Recommendation: separate product cycle

A new product cycle should design and implement:
1. **NEW UI control** — likely a small toggle / segmented control near the existing model picker (e.g., "200K | 1M") that is enabled only when the active model supports both tiers (claude opus/sonnet).
2. **MMKV persistence** — store the user's tier preference per-model in `mmkv.default\\preferred-tier-{modelId}`.
3. **AgentInput integration** — read the preferred-tier from MMKV; pass it to the daemon spawn flow as a parameter; reflect in the context-warning math at the user-defined denominator.
4. **Pricing transparency** — display "Premium pricing" indicator when the toggle is set above the standard tier.

This is a multi-component product change spanning happy-app + happy-cli + happy-server (CLI must propagate the tier choice to the Claude SDK; server must accept the tier in session metadata).

## Honesty contract (BA spec § Honesty markers)

**C3 status: user §5.2 quote 4 captured; existing model-switch UI documented as inadequate substitute; product cycle recommended.**

## Non-regression

No source change. Cycle 6 model-switch UI is preserved verbatim.
