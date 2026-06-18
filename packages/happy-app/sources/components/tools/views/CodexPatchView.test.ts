import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { parseUnifiedDiff } from '@/utils/codexUnifiedDiff';

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

// AC5 (apply_patch ADDED-file diff body) — the producer sends each added file as
//   change = { diff: '<raw full file content>', kind: { type: 'add' } }
// i.e. content lives in `change.diff` and is the RAW file body, NOT a unified diff with
// @@/+/- markers. The bug: getPatchTexts fell through to parseUnifiedDiff(change.diff) on
// raw content -> empty oldText/newText -> multi-file hasDiff (oldText||newText>0) false ->
// only the file header rendered, no diff body; single-file rendered an empty ToolDiffView.
// The fix adds kind-based add/delete raw-content handling BEFORE the parseUnifiedDiff
// fallback, so an ADD's raw content becomes newText (renders as an all-added file).
//
// CodexPatchView.tsx transitively imports react-native (cannot load in node-env vitest),
// so getPatchTexts is not directly importable. We extract its EXACT source from the file
// and execute it in a sandbox with the REAL parseUnifiedDiff injected. This is a GENUINE
// behavioral test of the shipped logic — it FAILS if the add/delete kind branches are
// reverted (the function would return empty newText again).
const getPatchTexts = (() => {
    const start = patchSrc.indexOf('function getPatchTexts');
    expect(start, 'getPatchTexts function not found in source').toBeGreaterThanOrEqual(0);
    // The function BODY opens at the brace immediately preceding its first statement
    // `if (change.modify)`. Anchoring here skips the return-TYPE annotation's own braces
    // (`: { oldText: string; newText: string }`), which would otherwise be brace-matched
    // as a (wrong, self-closing) body and yield an empty extraction.
    const firstStmt = patchSrc.indexOf('if (change.modify)', start);
    expect(firstStmt, 'getPatchTexts first statement anchor not found').toBeGreaterThan(start);
    const bodyOpen = patchSrc.lastIndexOf('{', firstStmt);
    expect(bodyOpen, 'getPatchTexts body-open brace not found').toBeGreaterThan(start);
    // Balance braces from the body open to its matching close.
    let depth = 0;
    let end = -1;
    for (let i = bodyOpen; i < patchSrc.length; i++) {
        const c = patchSrc[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    expect(end, 'getPatchTexts closing brace not found').toBeGreaterThan(bodyOpen);
    // Reconstruct as a plain (untyped) function declaration around the extracted body.
    const fnSource = `function getPatchTexts(change) ${patchSrc.slice(bodyOpen, end)}`;
    // Strip any remaining TS syntax so the body can be eval'd as plain JS.
    const js = transformSync(fnSource, { loader: 'ts' }).code;
    // Provide the real parseUnifiedDiff so the unified-diff fallback is exercised faithfully.
    // eslint-disable-next-line no-new-func
    const factory = new Function('parseUnifiedDiff', `${js}\nreturn getPatchTexts;`);
    return factory(parseUnifiedDiff) as (change: any) => { oldText: string; newText: string } | null;
})();

describe('AC5 — getPatchTexts handles kind-based add/delete raw-content (behavioral)', () => {
    it('add: raw content in change.diff becomes newText, oldText empty', () => {
        const result = getPatchTexts({ diff: 'line1\nline2\n', kind: { type: 'add' } });
        expect(result).toEqual({ oldText: '', newText: 'line1\nline2\n' });
    });

    it('add: raw content is NOT routed through parseUnifiedDiff (no markers stripped)', () => {
        // A leading '-' on a raw line would be eaten by parseUnifiedDiff; here it must survive.
        const raw = '-- a SQL comment\nSELECT 1;\n';
        const result = getPatchTexts({ diff: raw, kind: { type: 'add' } });
        expect(result).toEqual({ oldText: '', newText: raw });
    });

    it('delete: raw content in change.diff becomes oldText, newText empty', () => {
        const result = getPatchTexts({ diff: 'gone1\ngone2\n', kind: { type: 'delete' } });
        expect(result).toEqual({ oldText: 'gone1\ngone2\n', newText: '' });
    });

    it('multi-file map of two add entries yields non-empty newText for each (hasDiff true)', () => {
        const changes: Record<string, any> = {
            'src/a.ts': { diff: 'export const a = 1;\n', kind: { type: 'add' } },
            'src/b.ts': { diff: 'export const b = 2;\n', kind: { type: 'add' } },
        };
        for (const change of Object.values(changes)) {
            const texts = getPatchTexts(change);
            expect(texts).not.toBeNull();
            // Mirrors CodexPatchView's hasDiff = oldText.length>0 || newText.length>0.
            const hasDiff = !!texts && (texts.oldText.length > 0 || texts.newText.length > 0);
            expect(hasDiff).toBe(true);
            expect(texts!.newText.length).toBeGreaterThan(0);
        }
    });

    it('object branches still take precedence over kind-based handling (nested-shape variant)', () => {
        // When content arrives under change.add, that wins over the kind/diff path.
        const result = getPatchTexts({
            kind: { type: 'add' },
            diff: 'RAW BODY',
            add: { content: 'NESTED BODY' },
        });
        expect(result).toEqual({ oldText: '', newText: 'NESTED BODY' });
    });

    it('update with a real unified diff still flows through parseUnifiedDiff', () => {
        const unified = '@@ -1,2 +1,2 @@\n old\n-removed\n+added\n';
        const result = getPatchTexts({ diff: unified, kind: { type: 'update' } });
        // parseUnifiedDiff splits context/removed into oldText and context/added into newText.
        expect(result).not.toBeNull();
        expect(result!.oldText).toContain('removed');
        expect(result!.newText).toContain('added');
        expect(result!.newText).not.toContain('removed');
    });
});
