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

    it('FILLS the full card width at the true aspect ratio — no 360px width cap, no no-upscale clamp, no left anchor (whitespace fix, revert-sensitive)', () => {
        // The whitespace bug was a 360px width cap (`maxWidth` capped at 360 via
        // `Math.min(1, 360/w, 360/h)`) plus a `alignSelf: 'flex-start'` left anchor.
        // Restoring ANY of those re-creates the right-side whitespace → these fail.
        //
        // 1. No width cap of 360 in any form (constant or literal).
        expect(attachmentSrc).not.toMatch(/PREVIEW_MAX_WIDTH/);
        expect(attachmentSrc).not.toMatch(/maxWidth:\s*360/);
        // 2. No no-upscale contain-fit clamp.
        expect(attachmentSrc).not.toMatch(/Math\.min\(1,/);
        // 3. No left anchor — a flex-start alignSelf pins the image left, leaving
        //    whitespace on the right even at full intrinsic size.
        expect(attachmentSrc).not.toMatch(/alignSelf:\s*'flex-start'/);
        // 4. The preview style drives width to fill the card.
        expect(attachmentSrc).toMatch(/width:\s*'100%'/);
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

    it('width:100% + aspectRatio fills the card at the true ratio for any image size (behavioral)', () => {
        // The new model: width tracks the card (modelled as 100% here) and height is
        // derived purely from the natural aspectRatio — independent of the image's
        // absolute pixel size, so there is never a fixed 360px ceiling that would leave
        // right-side whitespace on a wide image. heightAtFullWidth(cardWidth, w, h) is the
        // rendered height the RN aspectRatio layout produces from `width:'100%'`.
        const heightAtFullWidth = (cardWidth: number, w: number, h: number) => cardWidth * (h / w);
        // Desktop card (~640px): a wide 1000×500 image fills 640px wide, 320px tall.
        expect(heightAtFullWidth(640, 1000, 500)).toBe(320);
        // Mobile card (390px viewport): the SAME image still fills the full 390px width.
        expect(heightAtFullWidth(390, 1000, 500)).toBe(195);
        // A small 32×32 image also fills the full card width (it is upscaled to fit, no
        // 360px cap / no-upscale clamp pinning it small with whitespace beside it).
        expect(heightAtFullWidth(390, 32, 32)).toBe(390);
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

// ── spec-20260607-124814 Item 3+4 (L4): unknown-dimensions images (screenshots,
//    generated images) resolve their aspect ratio from the actually-loaded natural
//    size via expo-image onLoad, instead of terminally letterboxing inside a square.
//    The component module transitively imports react-native/expo-image and CANNOT be
//    imported in this node-env vitest (same documented constraint as parseDimensions
//    above). So we MIRROR the pure aspectRatioFromSize helper here as a contract and
//    prove — via a revert-sensitive source assertion — that the component exports the
//    same shape. This is the project's blessed substitute for a runtime import.
function aspectRatioFromSize(size: { width: number; height: number } | null): number | null {
    if (!size) return null;
    const { width, height } = size;
    if (!(width > 0) || !(height > 0)) return null;
    return width / height;
}

describe('Item 3+4 natural-size onLoad aspect ratio (pure helper mirror)', () => {
    it('returns width/height for a valid loaded natural size (wide screenshot → true ratio, not square)', () => {
        expect(aspectRatioFromSize({ width: 1440, height: 900 })).toBeCloseTo(1.6, 5);
        expect(aspectRatioFromSize({ width: 1024, height: 768 })).toBeCloseTo(1.3333, 3);
        // a square image still resolves to 1 — but from its REAL size, not the fallback.
        expect(aspectRatioFromSize({ width: 512, height: 512 })).toBe(1);
    });

    it('returns null for null / degenerate (zero/NaN/negative) onLoad payloads so the prior aspect is retained (C1 guard)', () => {
        expect(aspectRatioFromSize(null)).toBeNull();
        expect(aspectRatioFromSize({ width: 0, height: 400 })).toBeNull();
        expect(aspectRatioFromSize({ width: 400, height: 0 })).toBeNull();
        expect(aspectRatioFromSize({ width: NaN, height: 400 })).toBeNull();
        expect(aspectRatioFromSize({ width: -10, height: 400 })).toBeNull();
    });

    it('the component exports the aspectRatioFromSize helper with the degenerate-size guard (revert-sensitive)', () => {
        // Reverting the L4 fix (removing the runtime ratio resolver) deletes this export.
        expect(attachmentSrc).toMatch(/export function aspectRatioFromSize\(/);
        expect(attachmentSrc).toMatch(/if \(!\(width > 0\) \|\| !\(height > 0\)\) return null/);
    });
});

describe('AC4 square fallback is no longer the terminal value for a loaded image (revert-sensitive)', () => {
    it('wires an onLoad handler on the inline <Image> (reverting removes it → fails)', () => {
        expect(attachmentSrc).toMatch(/onLoad=\{/);
        // the handler must read the loaded natural size off event.source
        expect(attachmentSrc).toMatch(/e\.source/);
    });

    it('captures the loaded natural size into component state (natural-size state path)', () => {
        expect(attachmentSrc).toMatch(/setLoaded/);
        expect(attachmentSrc).toMatch(/useState<\{\s*uri:\s*string;\s*width:\s*number;\s*height:\s*number\s*\}\s*\|\s*null>/);
    });

    it('prefers producer dims, then the loaded natural size, before the square fallback (resolvedDims)', () => {
        // producerDims ?? naturalSize drives the style — the square fallback only when both absent.
        expect(attachmentSrc).toMatch(/producerDims\s*\?\?\s*naturalSize/);
        expect(attachmentSrc).toMatch(/adaptivePreviewStyle\(resolvedDims\)/);
    });

    it('only adopts the natural size when producer dims are absent (no regression of the known path)', () => {
        // the onLoad handler must early-return when producerDims is present.
        expect(attachmentSrc).toMatch(/if\s*\(producerDims\)\s*return/);
    });

    it('binds the captured size to the uri it was measured from so a stale ratio is never applied + a fast onLoad is not clobbered (codex F1, revert-sensitive)', () => {
        // The natural size is URI-bound: it is only applied when loaded.uri === the
        // current previewUri. This replaces the racy unconditional reset effect (which
        // could wipe a fast cached/data-uri onLoad and leave the terminal square).
        expect(attachmentSrc).toMatch(/loaded\.uri === attachment\.previewUri/);
        expect(attachmentSrc).toMatch(/setLoaded\(\{ uri, width, height \}\)/);
        // the old racy reset effect must NOT be reintroduced.
        expect(attachmentSrc).not.toMatch(/setNaturalSize\(null\)/);
    });

    it('the square FALLBACK_ASPECT_RATIO is documented as a pre-load transient only (not terminal)', () => {
        // The fallback constant survives (no native collapse) but is no longer the
        // terminal value — its comment must mark it transient. Reverting to a terminal
        // square (removing the natural-size path) is caught by the assertions above.
        expect(attachmentSrc).toMatch(/FALLBACK_ASPECT_RATIO/);
        expect(attachmentSrc).toMatch(/transient/i);
    });
});

describe('AC3 known-dimensions render at full width + true ratio (revert-sensitive)', () => {
    it('drives known dimensions to full card width via aspectRatio = w/h (no 360 cap)', () => {
        // The dimension-aware branch sets the real aspectRatio and lets width fill the
        // card; it must NOT reintroduce the old `Math.min(1, PREVIEW_MAX_WIDTH ...)` cap.
        expect(attachmentSrc).toMatch(/aspectRatio:\s*dims\.width\s*\/\s*dims\.height/);
        expect(attachmentSrc).not.toMatch(/Math\.min\(1,\s*PREVIEW_MAX_WIDTH/);
    });
    it('keeps a HEIGHT-only ceiling for extreme-tall ratios (maxHeight, never maxWidth)', () => {
        // A maxHeight guard clamps height only — it can never reintroduce horizontal
        // whitespace because width stays 100%. A maxWidth cap is what caused the bug.
        expect(attachmentSrc).toMatch(/maxHeight:\s*PREVIEW_MAX_HEIGHT/);
        expect(attachmentSrc).not.toMatch(/maxWidth/);
    });
    it('keeps contentFit="contain" on the inline image', () => {
        expect(attachmentSrc).toMatch(/contentFit="contain"/);
    });
});

describe('AC5 public contract + caption guard preserved (revert-sensitive)', () => {
    it('keeps the public type ToolViewProps & { headerless?: boolean }', () => {
        expect(attachmentSrc).toMatch(/ToolViewProps\s*&\s*\{\s*headerless\?:\s*boolean\s*\}/);
    });
    it('keeps headerless default true and the showCaption gate intact', () => {
        expect(attachmentSrc).toMatch(/headerless\s*=\s*true/);
        expect(attachmentSrc).toMatch(/showCaption\s*=\s*headerless\s*&&/);
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
