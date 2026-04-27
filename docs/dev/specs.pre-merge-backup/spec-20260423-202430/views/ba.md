<!-- AUTO-GENERATED VIEW for ba | source: docs/dev/specs/spec-20260423-202430.md | extracted: 2026-04-23T20:24:30Z -->

# ba view of spec-20260423-202430

**Monolith**: docs/dev/specs/spec-20260423-202430.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate (from spec)

> **Pipeline**: standalone

---

## Spec Header

# Spec: Per-Session Model Persistence + Status Bar Model Display

**Pipeline**: standalone
**Session**: manual
**Created**: 2026-04-23T20:24:30+00:00

---

## Section 1: Before

<!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->
<!-- WHAT: Screenshot path + text description of the current state BEFORE any fix attempt. -->
<!-- This establishes the baseline so later cycles can compare. -->

---

## Section 5: User's Acceptance Criterion

<!-- WHO WRITES: BA (on first analysis) -->
<!-- WHAT: Verbatim quote from user's requirement or focus string. -->
<!-- This is the single source of truth for what "done" means. Do not paraphrase. -->

happy-dev 开发需求1：我需要每一个session的模型持久化，也就是说不会因为我切出session再切入就导致模型自动更换为默认模型。同时我要求模型应该能够再状态栏右侧显示（yolo前方）
每一次模型只会因为我手动在gui切换模型才会真的改变

**Summary (for reference):**
- Each session must persist its selected Claude model (opus/sonnet/haiku/default). Switching away from a session and back must NOT reset the model to default.
- The currently active model must be displayed in the status bar on the right side, positioned before "yolo".
- The model must only change when the user manually switches it in the GUI (the model radio button panel).

---

## Section 7: What Must Be Done

<!-- WHO WRITES: QA (on fail) or PM-Retro -->
<!-- WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action. -->
<!-- Example: "Increase padding from 8px to 16px in Chat.tsx:42" not "fix the padding" -->
