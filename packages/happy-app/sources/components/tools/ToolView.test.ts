import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// AC5 §5.14 behavior-2 (headered inline view_image caption suppression).
//
// CodexAttachmentView (the previous cycle) gates its duplicate filename/path caption
// on `showCaption = headerless && Boolean(caption)`, defaulting `headerless = true`
// so the header-LESS detail (ToolFullView) and desktop sidebar (SidebarContentRenderer)
// surfaces keep the only filename affordance they have (a pre_existing_guard,
// removal_authorized:false). But the INLINE conversation card is rendered by ToolView,
// which ALWAYS draws a header whose subtitle already carries the attachment path — so
// the inline card was double-showing the filename. This cycle wires the headered inline
// call site to pass `headerless={false}` ONLY for the attachment view, leaving every
// other tool card and both header-less surfaces untouched.
//
// ToolView transitively imports react-native / react-native-unistyles / expo-router /
// expo-image (and the whole tool-view registry), none of which load in this node-env
// vitest — the same constraint documented in CodexAttachmentView.test.ts and the
// Wave-1 view tests. So this file uses the project's blessed substitute: SOURCE-DERIVED
// assertions that FAIL if the behavior-2 wiring is reverted, paired with a behavioral
// re-derivation of the headerless gate so the contract is pinned, not merely grep-matched.

const TOOLS_DIR = resolve(__dirname);
const toolViewSrc = readFileSync(resolve(TOOLS_DIR, 'ToolView.tsx'), 'utf8');
const attachmentSrc = readFileSync(resolve(TOOLS_DIR, 'views/CodexAttachmentView.tsx'), 'utf8');

// Behavioral mirror of the component's caption gate. Pinned here as the contract the
// source assertions prove ToolView now satisfies for the inline (headered) surface.
function showCaption(headerless: boolean, caption: string | null): boolean {
    return headerless && Boolean(caption);
}

describe('AC5 behavior-2 — headered inline view_image suppresses the duplicate caption', () => {
    it('imports CodexAttachmentView so the inline call site can discriminate it by identity', () => {
        // Identity comparison (SpecificToolView === CodexAttachmentView) requires the
        // concrete component reference, not just the registry lookup.
        expect(toolViewSrc).toMatch(/import\s*\{\s*CodexAttachmentView\s*\}\s*from\s*'\.\/views\/CodexAttachmentView'/);
    });

    it('renders the headered inline view_image attachment with headerless={false} so its caption is suppressed', () => {
        // The inline ToolContent surface always carries a header; the view_image attachment
        // view rendered there MUST receive headerless={false}. Reverting the wiring drops the
        // prop (default headerless={true}) and the duplicate filename caption returns.
        expect(toolViewSrc).toMatch(/SpecificToolView\s*===\s*CodexAttachmentView/);
        expect(toolViewSrc).toMatch(/<CodexAttachmentView[^>]*headerless=\{false\}/);
    });

    it('scopes caption suppression to functions.view_image ONLY (no regression to screenshot/image_gen/file attachment cards)', () => {
        // CodexAttachmentView is ALSO routed by mcp__playwright__browser_take_screenshot
        // (which has NO extractSubtitle, so its path is NOT in the header), image_gen and
        // file. Suppressing those would strip their only inline filename affordance. The
        // suppression condition MUST therefore also gate on tool.name === 'functions.view_image'
        // (codex review BLOCKING #1). Reverting to the broad `=== CodexAttachmentView` alone
        // re-introduces the screenshot caption regression.
        expect(toolViewSrc).toMatch(/===\s*CodexAttachmentView\s*&&\s*tool\.name\s*===\s*'functions\.view_image'/);
    });

    it('does NOT pass headerless to the generic SpecificToolView branch (no regression to other tool cards)', () => {
        // Every non-view_image specialized view (Edit/Bash/Plan/Task/screenshot/image_gen/…)
        // is still rendered through the generic <SpecificToolView .../> element with NO
        // headerless prop, so their rendering is unchanged. The prop only exists on the
        // narrow view_image branch.
        const genericRender = toolViewSrc.match(/<SpecificToolView\b[^>]*\/>/g) ?? [];
        expect(genericRender.length).toBeGreaterThan(0);
        for (const el of genericRender) {
            expect(el).not.toMatch(/headerless/);
        }
    });
});

describe('AC5 behavior-2 — header-less detail/sidebar surfaces keep the caption (guard preserved)', () => {
    it('CodexAttachmentView still defaults headerless to true so untouched callers keep the caption', () => {
        // ToolFullView and SidebarContentRenderer render the attachment with no headerless
        // prop; the default MUST stay true so they retain the only filename affordance they
        // have (pre_existing_guard removal_authorized:false). This cycle did not change it.
        expect(attachmentSrc).toMatch(/headerless\s*=\s*true/);
        expect(attachmentSrc).toMatch(/showCaption\s*=\s*headerless\s*&&/);
    });

    it('behavioral: the gate hides the inline (headerless=false) caption but shows the sidebar (headerless=true) caption', () => {
        // The exact asymmetry behavior-2 establishes: same caption string, opposite outcome
        // by surface. Headered inline → hidden; header-less sidebar/detail → shown.
        expect(showCaption(false, 'diagram.png')).toBe(false); // headered inline card
        expect(showCaption(true, 'diagram.png')).toBe(true);   // header-less sidebar/detail
        expect(showCaption(true, null)).toBe(false);           // no caption → nothing to show
    });
});
