# Cycle 7 — AC-OUT-#6 Mermaid kernel out-of-saga (per user 绕开 directive)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7

## Codex Q5 framing (verbatim per BA spec)

> "Deferred to a Mermaid library/kernel investigation cycle per user instruction to 绕开 #6"

This is **NOT** "permanent out-of-saga", **NOT** "fixed", **NOT** "removed". It remains a known open item, intentionally bypassed in Cycle 7's scope per user directive.

## Failing diagram types (3 from saga catalog)

1. **timeline non-ASCII** — mermaid timeline parser rejects CJK / Arabic / non-ASCII characters in event entries. Cycle 6 added a sanitizer at `MermaidRenderer.tsx:8-21` (`sanitizeMermaidTimeline`) that strips non-ASCII from timeline blocks. The sanitizer is a partial workaround — it allows the diagram to render but loses meaningful content (e.g., a Chinese-localized timeline becomes English-tokens-only or empty).

2. **erDiagram** — entity-relationship diagrams fail to render in mermaid 11.x with certain syntax patterns. No sanitizer applied; user sees the type-aware error card with "erDiagram render failed".

3. **quadrantChart** — quadrant chart diagrams fail to render in mermaid 11.x with certain syntax patterns. No sanitizer applied; user sees the type-aware error card with "quadrantChart render failed".

## Current sanitizer scope (line:line)

`packages/happy-app/sources/components/markdown/MermaidRenderer.tsx`:
- `sanitizeMermaidTimeline` at lines 12-21 (timeline only)
- `extractMermaidDiagramType` at lines 26-37 (extract type for error display)
- No sanitizer for erDiagram or quadrantChart

## Recommended approach for the future cycle

Three viable options for the dedicated mermaid library/kernel investigation cycle:

### Option L (library upgrade)

Test mermaid 11.5+ / 12.x to see if the upstream library has fixed the failing types. If yes, upgrade the dependency and remove the sanitizer (or scope it to specific types still broken). Lowest-risk; relies on upstream.

### Option F (feature flag)

Add a settings toggle "Enable experimental mermaid types (timeline / erDiagram / quadrantChart)" that, when enabled, bypasses the sanitizer and surfaces the raw library error to the user. Default off (current behavior). Lets advanced users enable at their own risk.

### Option P (runtime probe)

At first-render time for each diagram type, do a synthetic dry-run probe with a known-good fixture for that type. If the probe fails, route the entire diagram to a "this type is unsupported by the current mermaid library version" error card with library-version info. Costs a small startup probe per diagram type but produces a graceful UX.

## Why this is NOT a Cycle 7 deliverable

User explicitly directed: "绕开 #6" (bypass #6). Cycle 7's scope is the codex iter-1 ratified Phase A + B-1 + C = 11 items. #6 is documented here for visibility in the saga close-report and for the future mermaid investigation cycle to inherit.
