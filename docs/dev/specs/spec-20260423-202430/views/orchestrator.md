<!-- AUTO-GENERATED VIEW for orchestrator | source: docs/dev/specs/spec-20260423-202430.md | extracted: 2026-04-23T20:24:30Z -->

# orchestrator view of spec-20260423-202430

**Monolith**: docs/dev/specs/spec-20260423-202430.md

---

## Role Mandate (from spec)

> **Pipeline**: standalone

---

## Pipeline Workflow

> **Pipeline**: standalone

> **Session**: manual

> <!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->

> <!-- WHO WRITES: Dev (after each implementation attempt) -->

> <!-- WHO WRITES: Dev (after each implementation) -->

> <!-- WHO WRITES: QA (after each verification) -->

> <!-- WHO WRITES: BA (on first analysis) -->

> <!-- WHO WRITES: QA (when verdict is fail) -->

> <!-- WHO WRITES: QA (on fail) or PM-Retro -->

<!-- WHO WRITES: PM-Retro -->
<!-- WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session. -->
<!-- Example: "This file is imported by 12 components -- changes here cascade widely" -->

---

## Acceptance Criterion

happy-dev 开发需求1：我需要每一个session的模型持久化，也就是说不会因为我切出session再切入就导致模型自动更换为默认模型。同时我要求模型应该能够再状态栏右侧显示（yolo前方）
每一次模型只会因为我手动在gui切换模型才会真的改变

**Summary (for reference):**
- Each session must persist its selected Claude model (opus/sonnet/haiku/default). Switching away from a session and back must NOT reset the model to default.
- The currently active model must be displayed in the status bar on the right side, positioned before "yolo".
- The model must only change when the user manually switches it in the GUI (the model radio button panel).

---

## Attention Notes

- The model selection UI is shown in the screenshot as a radio button panel (MODEL section: default model / opus 4.6 / sonnet 4.6 / haiku 4.5). This is within the session settings panel triggered by the gear icon (bottom-left of input area).
- The status bar currently shows: `● online  · 69% left  →→ yolo` on the right. The model name should appear to the LEFT of `→→ yolo`.
- The model is set per-session. When the user switches to a different session, that session's saved model should be loaded, NOT the global default.
- "Default model" is a valid option — if a session has "default model" selected, nothing extra is displayed (or display "default"), but it still persists as the chosen value for that session.
- This is a UI + persistence concern. Both the storage layer (session metadata or local state) and the rendering layer (status bar component) need changes.
- The model selection must only change via explicit user action in the GUI — no auto-resets on session switch, tab close, or reconnect.
