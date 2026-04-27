<!-- AUTO-GENERATED VIEW for orchestrator | source: docs/dev/specs/spec-20260424-084848.md | extracted: 2026-04-24T08:48:48Z -->

# orchestrator view of spec-20260424-084848

**Monolith**: docs/dev/specs/spec-20260424-084848.md

---

## Role Mandate (from spec)

> **Pipeline**: standalone
> **Session**: manual

---

## Pipeline Workflow

> WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context)

> WHO WRITES: Dev (after each implementation attempt)

> WHO WRITES: Dev (after each implementation)

> WHO WRITES: QA (after each verification)

> WHO WRITES: BA (on first analysis)

> WHO WRITES: QA (when verdict is fail)

> WHO WRITES: QA (on fail) or PM-Retro

> WHO WRITES: PM-Retro

---

## Agent Relevance Analysis

| Agent | Relevant | Reason |
|-------|----------|--------|
| ui-specialist | yes | 12+ requirements are visual design (5.3 popup overflow, 5.4/5.5 top-bar responsive layout, 5.6 popup redesign alignment, 5.8 table overflow, 5.11 detail panel, 5.12 attachment tray, 5.13/5.14 Codex rendering, 5.15 tool coverage, 5.16/5.17 markdown primitives, 5.18 CronList inline card) |
| ba | yes | Section 5 explicitly "WHO WRITES: BA". 18 acceptance criteria to decompose and track |
| dev | yes | Sections 2, 3 explicitly "WHO WRITES: Dev". Every requirement has concrete file paths + line numbers for implementation |
| qa | yes | Sections 4, 6 explicitly "WHO WRITES: QA". 18 acceptance criteria to verify with pixel-level measurement and screenshot evidence |
| pm | yes (supervisory) | Section 1 "WHO WRITES: PM"; Sections 7, 8 "PM-Retro". Triage/prioritization — decides item order, monitors progress across 18 requirements. NOT a pipeline stage. |
| architect | no | Spec has no architecture/structural/infrastructure concerns. No architect role markers, no dependency analysis, no scalability discussion |
| product-owner | no | No explicit product-owner role markers. Acceptance criteria are captured by BA in Section 5 |
| user | no | User's acceptance criteria are captured verbatim in Section 5 by BA; no separate user-writes workflow |

## Views Created

- ba.md
- dev.md
- qa.md
- pm.md
- ui-specialist.md
- orchestrator.md

## Monolith Sections

### Section 1: Before
<!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->

### Section 2: What Was Attempted
<!-- WHO WRITES: Dev (after each implementation attempt) -->

### Section 3: What Was Changed
<!-- WHO WRITES: Dev (after each implementation) -->

### Section 4: Current State
<!-- WHO WRITES: QA (after each verification) -->

### Section 5: User's Acceptance Criterion
<!-- WHO WRITES: BA (on first analysis) -->

### Section 6: Why Not Met
<!-- WHO WRITES: QA (when verdict is fail) -->

### Section 7: What Must Be Done
<!-- WHO WRITES: QA (on fail) or PM-Retro -->

### Section 8: Attention Notes
<!-- WHO WRITES: PM-Retro -->
