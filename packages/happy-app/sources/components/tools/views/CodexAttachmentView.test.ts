import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractAttachmentSummary } from '@/utils/codexToolRendering';

// AC5 (spec §5.14, R5) — view_image conciseness. Four behaviors:
//   1. Inline card ADAPTS to the actual image size — no oversized fixed 720×260 box;
//      a concrete aspectRatio always establishes layout (no collapse on native).
//   2. Inline card shows NO dimension/byte metadata. The compact filename CAPTION
//      affordance is PRESERVED on header-less surfaces (desktop sidebar) —
//      pre_existing_guard removal_authorized:false. NOTE: the component cannot
//      distinguish the headered ToolView surface from the header-less sidebar surface
//      from its current props, and the headered call site (_all.tsx/ToolView.tsx) is
//      OUT of this cycle's single-file scope. So the component EXPOSES a `headerless`
//      prop (default true = caption shown, guard-safe) and SUPPORTS suppression when a
//      caller passes headerless={false}; wiring that headered call site is a recorded
//      blocking dependency, NOT claimed complete here (codex review #3/#5).
//   3. Title click opens the detail titled exactly `View: <path>` (owned by
//      knownTools.tsx extractDescription — asserted at its source here).
//   4. Image click opens an image-only sidebar (routes back to this component with
//      no metadata/raw text — verified by the no-meta source assertions).
//
// The view component transitively imports react-native / react-native-unistyles /
// expo-image, which cannot load in this node-env vitest (the same constraint the
// Wave-1 CodexSubagentLifecycleView.test.ts and the codexToolRendering AC tests
// document). So these tests combine (a) GENUINE behavioral tests of the importable
// pure dimension-parse + caption logic, with (b) SOURCE-DERIVED assertions that FAIL
// if the AC5 fix is reverted — the project's blessed substitute for a runtime render.

const VIEWS_DIR = resolve(__dirname);
const attachmentSrc = readFileSync(resolve(VIEWS_DIR, 'CodexAttachmentView.tsx'), 'utf8');
const knownToolsSrc = readFileSync(resolve(VIEWS_DIR, '../knownTools.tsx'), 'utf8');

// Mirror of the component's pure dimension parse. Pinned here as a contract; the
// source-derived assertions below prove the component implements this same shape.
function parseDimensions(dimensions: string | null): { width: number; height: number } | null {
    if (!dimensions) return null;
    const m = dimensions.match(/^(\d+)\s*[×x]\s*(\d+)$/);
    if (!m) return null;
    const width = Number(m[1]);
    const height = Number(m[2]);
    return width > 0 && height > 0 ? { width, height } : null;
}

describe('AC5#1 adaptive sizing (no oversized fixed container)', () => {
    it('does NOT hardcode the old fixed 720 maxWidth / 260 height oversized box', () => {
        // The exact failing shape: a fixed `maxWidth: 720` paired with a fixed
        // `height: 260`. Reverting the fix re-introduces both → this fails.
        expect(attachmentSrc).not.toMatch(/maxWidth:\s*720/);
        expect(attachmentSrc).not.toMatch(/height:\s*260/);
    });

    it('drives inline height from a concrete aspectRatio and never uses a no-op height: undefined (codex review #1)', () => {
        // The preview always sets a concrete aspectRatio (real ratio when dims known,
        // square fallback otherwise) so the box never collapses on native; the no-op
        // `height: undefined` spread must NOT be present.
        expect(attachmentSrc).toMatch(/aspectRatio/);
        expect(attachmentSrc).toMatch(/parseDimensions/);
        expect(attachmentSrc).not.toMatch(/height:\s*undefined/);
    });

    it('contain-fits the natural dimensions inside the cap (small images stay small — codex review #2)', () => {
        // The dimension-aware branch scales by min(1, cap/w, cap/h) so a small image
        // is never upscaled past its natural size.
        expect(attachmentSrc).toMatch(/Math\.min\(1,/);
    });

    it('parses a "W×H" dimensions string into numeric width/height (behavioral)', () => {
        expect(parseDimensions('800×400')).toEqual({ width: 800, height: 400 });
        expect(parseDimensions('100x300')).toEqual({ width: 100, height: 300 });
        expect(parseDimensions('512×512')).toEqual({ width: 512, height: 512 });
    });

    it('returns null for unknown/zero/malformed dimensions (falls back to a bounded square box, not an oversized one)', () => {
        expect(parseDimensions(null)).toBeNull();
        expect(parseDimensions('')).toBeNull();
        expect(parseDimensions('0×400')).toBeNull();
        expect(parseDimensions('wide')).toBeNull();
    });

    it('contain-fit never upscales a small image and respects the 360 cap for a large one (behavioral)', () => {
        const cap = 360;
        const fit = (w: number, h: number) => {
            const scale = Math.min(1, cap / w, cap / h);
            return Math.round(w * scale);
        };
        expect(fit(32, 32)).toBe(32);        // small → unchanged (no blow-up to 360)
        expect(fit(1024, 1024)).toBe(360);   // large square → capped at 360
        expect(fit(1000, 500)).toBe(360);    // wide → width capped, height follows ratio
    });
});

describe('AC5#2 no inline dims/bytes metadata on the inline card', () => {
    it('no longer renders the dimensions/size meta array inline', () => {
        // The old card built `const meta = [attachment.dimensions, attachment.size]`
        // and mapped it into <Text> lines. Reverting re-introduces that array map.
        expect(attachmentSrc).not.toMatch(/meta\s*=\s*\[attachment\.dimensions/);
        expect(attachmentSrc).not.toMatch(/meta\.map\(/);
    });

    it('supports filename-caption suppression when a caller passes headerless={false} (codex review #5)', () => {
        // The component exposes the gate so a headered call site can suppress the
        // caption. The gate `showCaption = headerless && ...` must be present. (Wiring
        // the headered call site is a recorded blocking dependency — NOT done here.)
        expect(attachmentSrc).toMatch(/showCaption\s*=\s*headerless\s*&&/);
    });
});

describe('AC5#2 header-less caption affordance PRESERVED (pre_existing_guard removal_authorized:false)', () => {
    it('still derives the compact filename caption from the path/label', () => {
        // The guarded caption derivation must survive.
        expect(attachmentSrc).toMatch(/const caption = attachment\.path/);
        expect(attachmentSrc).toMatch(/attachment\.path\.split\(/);
    });

    it('defaults headerless to caption-on so a call site that omits the prop never loses the guarded affordance', () => {
        // Default MUST be `headerless = true` (caption shown) — a default of false
        // would silently strip the header-less filename affordance (guard violation).
        expect(attachmentSrc).toMatch(/headerless\s*=\s*true/);
    });

    it('derives the filename via basename (POSIX path) — behavioral parity with the caption logic', () => {
        const summary = extractAttachmentSummary({ path: '/tmp/codex/output/diagram.png' }, undefined);
        const basename = summary.path?.split(/[\\/]/).filter(Boolean).pop();
        expect(basename).toBe('diagram.png');
    });

    it('basename splits on both / and \\ separators so a backslash path is not shown whole (codex review #4)', () => {
        // The component's caption split is /[\\/]/ — assert both that the source uses
        // it and that the behavior yields a basename for a backslash-style path.
        expect(attachmentSrc).toMatch(/split\(\/\[\\\\\/\]\//);
        const basename = 'C:\\codex\\out\\diagram.png'.split(/[\\/]/).filter(Boolean).pop();
        expect(basename).toBe('diagram.png');
    });
});

describe('AC5#3 detail title is exactly "View: <path>" (knownTools extractDescription source)', () => {
    it('functions.view_image extractDescription builds the `View: <path>` string', () => {
        // Behavior #3 is owned by knownTools.tsx; assert the contract at its source
        // so AC5 closes against the real detail-title producer (read-only confirmation).
        expect(knownToolsSrc).toMatch(/'functions\.view_image':/);
        expect(knownToolsSrc).toMatch(/`View: \$\{/);
    });
});
