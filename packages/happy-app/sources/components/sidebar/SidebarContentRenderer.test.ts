import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// AC4 / R8 (spec §5.15.2): a Playwright screenshot opened into the RIGHT SIDEBAR must
// render ONLY the image (CodexAttachmentView), never the raw input/output JSON + base64
// dump (SidebarGenericView). Root cause: the screenshot identifier was missing from
// SidebarContentRenderer's ATTACHMENT_TOOLS allow-list, so it fell through to the generic
// JSON fallback — while the inline + full tool registries (_all.tsx) already routed the
// SAME identifier to CodexAttachmentView (asymmetry).
//
// SidebarContentRenderer.tsx transitively imports react-native / react-native-unistyles /
// expo, which cannot load in this node-env vitest (the same constraint documented in
// CodexSubagentLifecycleView.test.ts / codexToolRendering.test.ts). So this test combines
// (a) a GENUINE behavioral test of the sidebar routing precedence reconstructed faithfully
// from source, with (b) SOURCE-DERIVED assertions that FAIL if the allow-list entry is
// reverted. The screenshot identifier is read FROM the inline/full registries (not a
// hardcoded guess) and the sidebar allow-list is asserted to use that exact string.

const SCREENSHOT_TOOL = 'mcp__playwright__browser_take_screenshot';

const SIDEBAR_DIR = resolve(__dirname);
const sidebarSrc = readFileSync(resolve(SIDEBAR_DIR, 'SidebarContentRenderer.tsx'), 'utf8');
const registrySrc = readFileSync(resolve(SIDEBAR_DIR, '../tools/views/_all.tsx'), 'utf8');

// Parse a `const NAME_TOOLS = new Set([...])` literal into its string members.
function parseSet(src: string, name: string): string[] {
    const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    if (!m) throw new Error(`set ${name} not found in SidebarContentRenderer.tsx`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// Reconstruct the render precedence chain faithfully from the component body. Each branch
// is `if (<SET>.has(tool.name)) { return <ViewName ...`, terminated by the generic fallback.
const SET_NAMES = [
    'AGENT_TOOLS', 'FILE_TOOLS', 'BASH_TOOLS', 'TODO_TOOLS',
    'PLAN_TOOLS', 'ATTACHMENT_TOOLS', 'PARALLEL_TOOLS',
];
function parseRoutingChain(src: string): { set: string; view: string }[] {
    return [...src.matchAll(/if \((\w+_TOOLS)\.has\(tool\.name\)\)\s*\{\s*return <(\w+)/g)]
        .map((m) => ({ set: m[1], view: m[2] }));
}
function routeSidebar(toolName: string): string {
    const sets: Record<string, Set<string>> = {};
    for (const name of SET_NAMES) sets[name] = new Set(parseSet(sidebarSrc, name));
    for (const { set, view } of parseRoutingChain(sidebarSrc)) {
        if (sets[set]?.has(toolName)) return view;
    }
    return 'SidebarGenericView'; // the unmatched fallback at the end of the render body
}

describe('AC4 sidebar screenshot routing (behavioral, reconstructed from source)', () => {
    it('routes the Playwright screenshot to the image-only CodexAttachmentView', () => {
        expect(routeSidebar(SCREENSHOT_TOOL)).toBe('CodexAttachmentView');
    });

    it('does NOT route the screenshot to the raw-JSON/base64 SidebarGenericView fallback', () => {
        expect(routeSidebar(SCREENSHOT_TOOL)).not.toBe('SidebarGenericView');
    });

    it('still falls through to SidebarGenericView for a tool in no allow-list (router fidelity)', () => {
        // Guards against a rigged router: an unmapped tool MUST still hit the generic path,
        // so the screenshot result above is meaningful (it passes only via the allow-list add).
        expect(routeSidebar('functions.some_unmapped_tool')).toBe('SidebarGenericView');
    });
});

describe('AC4 source-derived assertions (fail if the allow-list entry is reverted)', () => {
    it('includes the screenshot identifier in the ATTACHMENT_TOOLS allow-list', () => {
        expect(parseSet(sidebarSrc, 'ATTACHMENT_TOOLS')).toContain(SCREENSHOT_TOOL);
    });

    it('uses the SAME identifier the inline + full tool registries route to CodexAttachmentView', () => {
        // _all.tsx maps the screenshot identifier to CodexAttachmentView in BOTH the inline
        // (toolViewRegistry) and full (toolFullViewRegistry) registries. Asserting >=2 hits and
        // that the sidebar allow-list contains the exact same string proves the identifier was
        // taken FROM source, not hardcoded as a guess (dispatch requirement).
        const registryHits = [...registrySrc.matchAll(
            /'(mcp__playwright__browser_take_screenshot)':\s*CodexAttachmentView/g,
        )];
        expect(registryHits.length).toBeGreaterThanOrEqual(2);
        expect(parseSet(sidebarSrc, 'ATTACHMENT_TOOLS')).toContain(registryHits[0][1]);
    });

    it('preserves the pre-existing attachment members (no regression to view_image / image_gen routing)', () => {
        const members = parseSet(sidebarSrc, 'ATTACHMENT_TOOLS');
        for (const m of ['file', 'functions.view_image', 'mcp__image_gen__imagegen', 'image_gen.imagegen']) {
            expect(members).toContain(m);
        }
    });
});

describe('Wave-2 fix: functions.image_generation sidebar + detail routing (close-blocker 20260606-162217)', () => {
    // The Codex producer emits the REAL name functions.image_generation (the older
    // mcp__image_gen__imagegen / image_gen.imagegen are never emitted). It was added to the
    // inline + full view registries (_all.tsx) but omitted from the sidebar ATTACHMENT_TOOLS
    // and the ToolFullView SPECIALIZED_FULL_PAYLOAD_TOOLS sets, so the detail page + right
    // sidebar leaked the raw multi-MB base64 data-URI (§5.14#4 / §5.15.2). These assertions
    // FAIL if either gate-set entry is reverted.
    const IMAGE_GEN_TOOL = 'functions.image_generation';
    const toolFullViewSrc = readFileSync(resolve(SIDEBAR_DIR, '../tools/ToolFullView.tsx'), 'utf8');

    it('routes the real image_generation tool to the image-only CodexAttachmentView, not the raw-JSON SidebarGenericView', () => {
        expect(routeSidebar(IMAGE_GEN_TOOL)).toBe('CodexAttachmentView');
        expect(routeSidebar(IMAGE_GEN_TOOL)).not.toBe('SidebarGenericView');
    });

    it('includes functions.image_generation in the sidebar ATTACHMENT_TOOLS allow-list', () => {
        expect(parseSet(sidebarSrc, 'ATTACHMENT_TOOLS')).toContain(IMAGE_GEN_TOOL);
    });

    it('uses the SAME real name the inline + full tool registries route to CodexAttachmentView', () => {
        const registryHits = [...registrySrc.matchAll(
            /'(functions\.image_generation)':\s*CodexAttachmentView/g,
        )];
        expect(registryHits.length).toBeGreaterThanOrEqual(2);
        expect(parseSet(sidebarSrc, 'ATTACHMENT_TOOLS')).toContain(registryHits[0][1]);
    });

    it('marks functions.image_generation as a SPECIALIZED_FULL_PAYLOAD_TOOL so the detail suppresses the raw data-URI dump (§5.14#4)', () => {
        expect(parseSet(toolFullViewSrc, 'SPECIALIZED_FULL_PAYLOAD_TOOLS')).toContain(IMAGE_GEN_TOOL);
    });
});
