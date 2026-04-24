<!-- AUTO-GENERATED VIEW for dev | source: docs/dev/specs/spec-20260423-202430.md | extracted: 2026-04-23T20:24:30Z -->

# dev view of spec-20260423-202430

**Monolith**: docs/dev/specs/spec-20260423-202430.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate (from spec)

> **Pipeline**: standalone

---

## Section 8: Attention Notes

<!-- WHO WRITES: PM-Retro -->
<!-- WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session. -->
<!-- Example: "This file is imported by 12 components -- changes here cascade widely" -->

- The model selection UI is shown in the screenshot as a radio button panel (MODEL section: default model / opus 4.6 / sonnet 4.6 / haiku 4.5). This is within the session settings panel triggered by the gear icon (bottom-left of input area).
- The status bar currently shows: `● online  · 69% left  →→ yolo` on the right. The model name should appear to the LEFT of `→→ yolo`.
- The model is set per-session. When the user switches to a different session, that session's saved model should be loaded, NOT the global default.
- "Default model" is a valid option — if a session has "default model" selected, nothing extra is displayed (or display "default"), but it still persists as the chosen value for that session.
- This is a UI + persistence concern. Both the storage layer (session metadata or local state) and the rendering layer (status bar component) need changes.
- The model selection must only change via explicit user action in the GUI — no auto-resets on session switch, tab close, or reconnect.

---

## Section 2: What Was Attempted

<!-- WHO WRITES: Dev (after each implementation attempt) -->
<!-- WHAT: Per-cycle record of what approach was tried, what the rationale was, and why it failed (if it failed). -->
<!-- This prevents the next cycle's Dev from repeating the same approach. -->

### Cycle 1

_Not yet populated._

---

## Section 3: What Was Changed

<!-- WHO WRITES: Dev (after each implementation) -->
<!-- WHAT: Exact file changes with line numbers and old->new values. -->
<!-- FORMAT: - **file.tsx:42** -- `property: oldValue` -> `property: newValue` -->

### Cycle 1

_Not yet populated._
