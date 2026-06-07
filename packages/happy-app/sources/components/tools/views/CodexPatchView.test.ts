import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Wave 1 / Item 9 (spec-20260607-124814 §2) — Codex apply_patch/diff render parity.
//
// The user did not see apply_patch/Update diffs render at the live gate; the spec also
// requires NO duplicate file/update icon. The render path (producer -> _all.tsx registry
// -> codexToolRendering gate -> CodexPatchView) is wired end-to-end; the in-scope code
// defect was the inner per-file `Octicons name="file-diff"` on the MULTI-FILE path
// (CodexPatchView inline + CodexPatchViewFull), which duplicated the outer ToolView
// header icon (knownTools CodexPatch.icon = ICON_EDIT = file-diff). The fix removes the
// INNER icon only; the outer header icon (FORBIDDEN files) is the correct card affordance.
//
// The view component transitively imports react-native / react-native-unistyles, which
// cannot load in this node-env vitest (the same constraint CodexAttachmentView.test.ts /
// CodexSubagentLifecycleView.test.ts document). So these tests combine (a) a GENUINE
// behavioral assertion of the importable knownTools config (body-render gate), with
// (b) SOURCE-DERIVED, revert-sensitive assertions that FAIL if the icon-removal fix is
// reverted — the project's blessed substitute for a runtime render. Live desktop+mobile
// render is the user's binding gate per spec §4.

const VIEWS_DIR = resolve(__dirname);
const patchSrc = readFileSync(resolve(VIEWS_DIR, 'CodexPatchView.tsx'), 'utf8');
const diffSrc = readFileSync(resolve(VIEWS_DIR, 'CodexDiffView.tsx'), 'utf8');
const allSrc = readFileSync(resolve(VIEWS_DIR, '_all.tsx'), 'utf8');
// knownTools.tsx transitively imports @expo/vector-icons, which cannot load in node-env
// vitest (documented constraint). Read its source for the CodexPatch body-gate assertion.
const knownToolsSrc = readFileSync(resolve(VIEWS_DIR, '../knownTools.tsx'), 'utf8');
// The CodexPatch config block, sliced so minimal:false is asserted on THIS tool only.
const codexPatchConfig = knownToolsSrc.slice(
    knownToolsSrc.indexOf("'CodexPatch': {"),
    knownToolsSrc.indexOf("'CodexDiff': {"),
);

// Branch anchors. Guard each lookup so a harmless comment edit surfaces as an explicit
// "anchor moved" failure instead of a silently-empty slice that would pass vacuously.
function sliceBetween(src: string, startAnchor: string, endAnchor: string): string {
    const start = src.indexOf(startAnchor);
    const end = src.indexOf(endAnchor);
    expect(start, `start anchor not found: ${startAnchor}`).toBeGreaterThanOrEqual(0);
    expect(end, `end anchor not found: ${endAnchor}`).toBeGreaterThan(start);
    return src.slice(start, end);
}

// Single-file branch (entries.length === 1) of the inline component.
const singleFileBranch = sliceBetween(
    patchSrc,
    'if (entries.length === 1)',
    '// Multi-file: render per-file header',
);

// Multi-file branch of the INLINE component only (CodexPatchView), bounded by the Full
// component declaration — so a regression that drops the icon-free title+diff structure
// from the inline branch is caught even if CodexPatchViewFull still has it.
const multiFileInlineBranch = sliceBetween(
    patchSrc,
    '// Multi-file: render per-file header',
    'export const CodexPatchViewFull',
);

describe('AC1 — render path stays wired (body gate + registry)', () => {
    it('knownTools CodexPatch declares minimal: false so the body gate stays open', () => {
        // codexToolRendering gate returns false (suppresses body) only when minimal:true.
        // CodexPatch must keep minimal:false or the inline patch body never renders.
        expect(codexPatchConfig).toMatch(/minimal:\s*false/);
    });

    it('_all.tsx registry maps CodexPatch -> CodexPatchView and CodexDiff -> CodexDiffView', () => {
        // Revert guard for the routing wiring (FORBIDDEN file, read-only assertion).
        expect(allSrc).toMatch(/CodexPatch:\s*CodexPatchView/);
        expect(allSrc).toMatch(/CodexDiff:\s*CodexDiffView/);
    });
});

describe('AC2 — single-file inline has no duplicate (inner) icon', () => {
    it('single-file branch renders the diff body only — no inner fileHeader or file-diff icon', () => {
        expect(singleFileBranch).toMatch(/ToolDiffView/);
        expect(singleFileBranch).not.toMatch(/styles\.fileHeader/);
        expect(singleFileBranch).not.toMatch(/file-diff/);
    });
});

describe('AC3 — multi-file inline: per-file title + diff, NO inner file-diff icon (Must)', () => {
    it('CodexPatchView.tsx contains no inner Octicons file-diff icon anywhere (inline + Full)', () => {
        // Revert-sensitive: re-adding the inner per-file icon re-introduces this string.
        expect(patchSrc).not.toMatch(/name="file-diff"/);
    });

    it('Octicons / @expo/vector-icons import was dropped now that the inner icon is gone', () => {
        // After removing both inner icons the import is unused; keeping it would fail
        // lint/typecheck cleanliness and signals a partial revert.
        expect(patchSrc).not.toMatch(/@expo\/vector-icons/);
        expect(patchSrc).not.toMatch(/\bOcticons\b/);
    });

    it('multi-file INLINE branch keeps per-file title + diff and drops the inner icon (branch-scoped)', () => {
        // Asserted within the inline branch slice (codex review #2): the per-file header
        // (file path) + ToolDiffView must survive the icon removal, AND the inner
        // file-diff icon must be gone from THIS branch specifically.
        expect(multiFileInlineBranch).toMatch(/styles\.fileHeader\b/);
        expect(multiFileInlineBranch).toMatch(/styles\.filePath/);
        expect(multiFileInlineBranch).toMatch(/ToolDiffView/);
        expect(multiFileInlineBranch).not.toMatch(/name="file-diff"/);
        expect(multiFileInlineBranch).not.toMatch(/Octicons/);
    });

    it('useUnistyles/theme dropped from the components (only the removed icons used theme)', () => {
        // The StyleSheet factory still receives `theme`, but the components no longer
        // call useUnistyles(); a partial revert that re-adds the icon would re-add this.
        expect(patchSrc).not.toMatch(/useUnistyles/);
    });
});

describe('AC4 — CodexDiffView is and stays icon-free (revert guard)', () => {
    it('CodexDiffView.tsx imports no Octicons / @expo/vector-icons (no duplicate-icon concern)', () => {
        expect(diffSrc).not.toMatch(/@expo\/vector-icons/);
        expect(diffSrc).not.toMatch(/\bOcticons\b/);
        expect(diffSrc).not.toMatch(/name="file-diff"/);
    });
});
