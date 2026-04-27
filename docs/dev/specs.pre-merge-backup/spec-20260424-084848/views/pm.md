<!-- AUTO-GENERATED VIEW for pm | source: docs/dev/specs/spec-20260424-084848.md | extracted: 2026-04-24T08:48:48Z -->

# pm view of spec-20260424-084848

**Monolith**: docs/dev/specs/spec-20260424-084848.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate (from spec)

> WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context)

> WHO WRITES: QA (on fail) or PM-Retro

> WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action.

> WHO WRITES: PM-Retro

> WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session.

> Example: "This file is imported by 12 components -- changes here cascade widely"

---

# Spec: Per-session model persistence + model indicator in status bar

**Pipeline**: standalone
**Session**: manual
**Created**: 2026-04-24T08:48:48+00:00

---

## Section 1: Before

<!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->
<!-- WHAT: Screenshot path + text description of the current state BEFORE any fix attempt. -->
<!-- This establishes the baseline so later cycles can compare. -->

### Cycle 1

Reference screenshot provided by user: `/tmp/happy-attachments/67a57680-cde1-4343-833f-ad5644955740-image.png`
- Settings panel with PERMISSION MODE (`yolo` selected) and MODEL (`haiku 4.5` selected).
- Status row: `● online • 69% left` on the left, `▶▶ yolo` on the right.
- Model label is NOT shown in the status row today.

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

---

## Prioritization worklist (18 requirements, grouped by theme)

### Theme A — Model/session state (high user-visible severity)

### 5.1: Per-session model persistence + model indicator in status bar (verbatim)

### 5.2: 1M-context Claude models — context-usage display broken (verbatim)

### Theme B — Markdown & inline rendering (medium-to-high severity, wide scope)

### 5.17: Several markdown primitives are not rendered (verbatim)

### 5.16: Inline LaTeX math is not rendered (verbatim)

### 5.8: Markdown tables overflow width — port the fix already in happy prod (verbatim)

### Theme C — Codex parity with Claude Code (medium severity, large surface area)

### 5.15: Codex tool coverage — only `exec_command` renders; all other Codex tools are invisible (verbatim)

### 5.13: Codex subagent tasks are not displayed (verbatim)

### 5.14: Codex multi-file edit — no right-sidebar rendering (verbatim)

### 5.6: Codex tool-call popup — not aligned with Claude Code popup redesign (verbatim)

### 5.7: Codex tool-call popup — Description field content is wrong (verbatim)

### Theme D — Transport / session lifecycle

### 5.10: Long background-task disconnect causes out-of-order delivery on reconnect (verbatim)

### 5.9: Stop-hook feedback must not be shown to the user (verbatim)

### Theme E — Layout / overflow in main chrome

### 5.4: Top bar — happy logo and avatar positions are hardcoded, not responsive (verbatim)

### 5.5: Top bar / layout — second non-adaptive case (verbatim)

### 5.3: Right-side Bash popup — command text overflows popup width (verbatim)

### 5.11: Detail panel — long file path overflows the header (verbatim)

### 5.12: Attachment tray — width inconsistency + silent failure on oversize upload (verbatim)

### 5.18: CronList tool — inline card is too verbose; move detail to sidebar (verbatim)

---

## Section 7: What Must Be Done

<!-- WHO WRITES: QA (on fail) or PM-Retro -->
<!-- WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action. -->
<!-- Example: "Increase padding from 8px to 16px in Chat.tsx:42" not "fix the padding" -->

### Cycle 1

_Not yet populated._

---

## Section 8: Attention Notes

<!-- WHO WRITES: PM-Retro -->
<!-- WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session. -->
<!-- Example: "This file is imported by 12 components -- changes here cascade widely" -->
