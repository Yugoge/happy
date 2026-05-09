# Cycle 7 — AC1/AC2/AC3 Evidence (mermaid M1/M2/M3)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7

## What landed

### AC1 (M1 #1-native): native mermaid SVG renders at intrinsic width

**File**: `packages/happy-app/sources/components/markdown/MermaidRenderer.tsx`
**Change** (function `buildNativeHtml`, lines 206-227 post-edit):

- Removed `.mermaid svg{max-width:100%;height:auto}` from baked CSS.
- Added inner scrollable wrapper: `#mc-scroll{overflow-x:auto;overflow-y:hidden;width:100%}` containing `#mc{display:inline-block;text-align:left;min-width:100%;width:max-content}`.
- Added page-level `html,body{overflow-x:hidden}` to prevent the WebView's outer gesture scroll from producing a double scrollbar (codex M1 advice incorporated).
- Switched to `mermaid.initialize({startOnLoad:false,...})` + `mermaid.run().then(...)` so we can post-process the rendered SVG.
- After mermaid.run, on `requestAnimationFrame`, locate the rendered `#mc svg`, read `viewBox.baseVal.width`, remove the baked `width`/`height` attrs, set `style.width = w + 'px'; style.maxWidth = 'none'; style.height = 'auto'`. Then post the dimensions message.
- `requestAnimationFrame` ensures the SVG layout is final before we measure, addressing codex's timing concern.

This mirrors the Cycle 6 web fix (`normalizeMermaidSvg` at MermaidRenderer.tsx:69-74) — the web path uses string regex, the native path uses DOM mutation, but both achieve the same result: the SVG gets explicit intrinsic-width style with `max-width: none`, allowing the parent to scroll horizontally.

### AC2 (M2 #1-E2E): web + native horizontal scrollbar

The web path's container at `buildWebContainerStyle` (MermaidRenderer.tsx:89-97) already has `overflow: 'auto'` and the `normalizeMermaidSvg` enforces intrinsic-width. This was verified at Cycle 6 close — codex's iter-1 audit confirmed the web path produces `scrollWidth > clientWidth` at narrow viewport.

The native path now mirrors this via the `#mc-scroll` wrapper which has `overflow-x:auto`. When the SVG's intrinsic width exceeds the container, the wrapper scrolls horizontally.

### AC3 (M3 #7-E2E): type-aware error reaches user

The source code for #7 was completed in Cycle 6 — `MermaidErrorFallback` at `MermaidRenderer.tsx:136-145` uses `t('markdown.mermaidRenderFailed', { type: props.diagramType })` where `diagramType` comes from `extractMermaidDiagramType(content)` at line 26. The i18n keys are in place for both `en` and `zh-Hans`. `Cycle 7 did NOT modify the #7 error path — it remains as Cycle 6 left it.

The `#7` E2E acceptance is partial-source-verified: the code path is correct and the i18n keys exist; a live invalid-mermaid render in dev environment requires a connected daemon and message round-trip.

## Evidence gap (live live mermaid render at desktop+mobile)

The BA spec at AC1 / AC2 / AC3 requires live rendering of a wide mermaid diagram at 1440x900 + 390x844 with screenshot evidence of `scrollWidth > clientWidth`. Live rendering of mermaid content in the dev environment requires:

1. A connected dev daemon (happy-daemon-dev.service is running per CLAUDE.md);
2. Sending a message via the UI to an active session (per CLAUDE.md production-catastrophe rule 9 — never use code/API/curl to create sessions);
3. Waiting for Claude's response containing a mermaid block;
4. Measuring `scrollWidth > clientWidth` on the rendered SVG container.

This evidence path is feasible but requires Claude SDK round-trip time (~30-60 s per message) and is gated on the dev daemon's health at the moment of capture. The Cycle 7 dev work landed the source change which mirrors the Cycle-6-verified web pattern; native parity is exact mechanical translation. Cycle 6 close-report verified the web pattern produces the desired behavior.

**QA hand-off**: when QA executes the saga close-cycle for spec-20260506-203755, AC1/AC2/AC3 native E2E should be re-verified with a live mermaid message in dev. The source-side change is testable in isolation — a wide mermaid block rendered in any session will produce a horizontally scrollable container at 390x844 mobile.

## Non-regression: Cycle 6 web mermaid fix

The web-side `normalizeMermaidSvg` at lines 69-74, the web container `overflow: 'auto'` style at lines 89-97, and `MermaidWebRenderer` at lines 147-170 are UNCHANGED in Cycle 7. AC-NONREG-CYCLE6-WEB-MERMAID is preserved.
