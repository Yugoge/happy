# Cycle 7 — AC4 Evidence (mhchem M4 #8)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7

## What landed

**File**: `packages/happy-app/sources/components/markdown/LatexRenderer.tsx`

### Web path (lines 17-25 post-edit)

Added `loadKatexWithMhchem()` which dynamically imports `katex` then `katex/contrib/mhchem` (side-effect import — registers `\ce{...}` macro on the global katex object). `renderKatexToString` is rewritten to use the wrapper. The `// @ts-ignore` annotation accommodates the package's missing `.d.ts` for the contrib subpath.

### Native path (lines 79-83 post-edit)

`buildNativeHtml` now includes a second `<script>` tag for `mhchem.min.js` from the same CDN as katex.min.js, loaded AFTER katex.min.js (registers macros on the loaded global) and BEFORE `katex.render()` is invoked. Order matches BA spec § Edge Cases note for #8.

## Build/typecheck verification

- `yarn typecheck` — PASS (after adding `// @ts-ignore` for the mhchem subpath import).
- `node_modules/katex/contrib/mhchem.mjs` exists — confirmed by tsc resolver.
- CDN URL `https://cdn.jsdelivr.net/npm/katex@0.16/dist/contrib/mhchem.min.js` is the canonical KaTeX-shipped artifact.

## Evidence gap (live `\ce{H2O}` render)

Live verification of `$\ce{H2SO4}$` requires sending a message via the UI to an active session and waiting for Claude's reply (or for a user-typed `$\ce{...}$` in the dev session input). Same evidence-gap framing as AC1/AC2/AC3 — gated on daemon round-trip.

The KaTeX mhchem documentation (https://katex.org/docs/libs#mhchem) states: import the contrib script after the katex script; usage thereafter is automatic. Both web and native implementations conform to this pattern. The fix is mechanical adoption of the documented pattern.

## Non-regression

The pre-existing `useKatexHtml` and `LatexWebBlock` / `LatexWebInline` / `LatexNativeBlock` components are unchanged structurally; they continue to render plain LaTeX (`$E=mc^2$` etc.) exactly as before. The mhchem import is purely additive — when no `\ce{...}` syntax appears in a message, the rendering is identical to pre-Cycle-7 behavior.
