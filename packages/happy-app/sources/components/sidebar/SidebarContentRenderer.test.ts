import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// RECONCILED for Wave-1 Item 1 (spec-20260607-124814 §2 Item 1).
//
// Predecessor cycles routed the image tools opened into the RIGHT SIDEBAR (desktop
// detail surface) to CodexAttachmentView — i.e. the DETAIL page rendered the actual
// image. Wave-1 INTENTIONALLY reversed that: the image-tool detail must be a
// Claude-Code-style TEXT-ONLY view (Description → Input Params JSON → Output
// path/dimensions/type) that renders NO <Image> and leaks NO raw base64, on BOTH the
// mobile (ToolFullView/_all.tsx) AND desktop (this SidebarContentRenderer) surfaces.
// The desktop sidebar now routes the image tools to the new text-only ImageToolFullView,
// gated by the shared IMAGE_DETAIL_TOOLS source-of-truth Set (imageToolDetail.ts). The
// old ATTACHMENT_TOOLS Set and the CodexAttachmentView image branch were REMOVED from
// this renderer (inline chat cards still use CodexAttachmentView — that is a different,
// untouched item; the inline preview belongs ONLY to the inline chat card).
//
// SidebarContentRenderer.tsx transitively imports react-native / react-native-unistyles /
// expo, which cannot load in this node-env vitest (the same constraint documented in
// CodexSubagentLifecycleView.test.ts / codexToolRendering.test.ts). So this test combines
// (a) a GENUINE behavioral test of the sidebar routing precedence reconstructed faithfully
// from source, with (b) SOURCE-DERIVED assertions that FAIL if any routing edit is reverted
// (e.g. re-pointing detail back to CodexAttachmentView, or dropping the IMAGE_DETAIL_TOOLS
// branch so image tools fall through to the raw-JSON/base64 SidebarGenericView).

const SIDEBAR_DIR = resolve(__dirname);
const sidebarSrc = readFileSync(resolve(SIDEBAR_DIR, 'SidebarContentRenderer.tsx'), 'utf8');
const registrySrc = readFileSync(resolve(SIDEBAR_DIR, '../tools/views/_all.tsx'), 'utf8');
const imageDetailSrc = readFileSync(resolve(SIDEBAR_DIR, '../tools/views/imageToolDetail.ts'), 'utf8');

const NAMED_IMAGE_TOOLS = [
    'functions.view_image',
    'mcp__playwright__browser_take_screenshot',
    'functions.image_generation',
];

// Parse a `const NAME_TOOLS = new Set([...])` literal into its string members.
function parseSet(src: string, name: string): string[] {
    const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    if (!m) throw new Error(`set ${name} not found in source`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// Parse the exported IMAGE_DETAIL_TOOLS source-of-truth set (typed `new Set<string>([...])`).
function parseImageDetailTools(): string[] {
    const m = imageDetailSrc.match(/export const IMAGE_DETAIL_TOOLS = new Set<string>\(\[([\s\S]*?)\]\)/);
    if (!m) throw new Error('IMAGE_DETAIL_TOOLS set not found in imageToolDetail.ts');
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// Reconstruct the render precedence chain faithfully from the component body. Each branch
// is `if (<SET>.has(tool.name)) { return <ViewName ...`, terminated by the generic fallback.
// The image branch uses the IMPORTED IMAGE_DETAIL_TOOLS set (resolved from imageToolDetail.ts);
// the other *_TOOLS sets are locally declared in the component source.
const LOCAL_SET_NAMES = [
    'AGENT_TOOLS', 'FILE_TOOLS', 'BASH_TOOLS', 'TODO_TOOLS', 'PLAN_TOOLS', 'PARALLEL_TOOLS',
];
function parseRoutingChain(src: string): { set: string; view: string }[] {
    return [...src.matchAll(/if \((\w+)\.has\(tool\.name\)\)\s*\{\s*return <(\w+)/g)]
        .map((m) => ({ set: m[1], view: m[2] }));
}
function routeSidebar(toolName: string): string {
    const sets: Record<string, Set<string>> = {};
    for (const name of LOCAL_SET_NAMES) sets[name] = new Set(parseSet(sidebarSrc, name));
    // The image branch reads the imported source-of-truth set.
    sets['IMAGE_DETAIL_TOOLS'] = new Set(parseImageDetailTools());
    for (const { set, view } of parseRoutingChain(sidebarSrc)) {
        if (sets[set]?.has(toolName)) return view;
    }
    return 'SidebarGenericView'; // the unmatched fallback at the end of the render body
}

describe('Wave-1 Item 1 desktop detail routing (behavioral, reconstructed from source)', () => {
    for (const name of NAMED_IMAGE_TOOLS) {
        it(`routes ${name} to the text-only ImageToolFullView (no image render on detail)`, () => {
            expect(routeSidebar(name)).toBe('ImageToolFullView');
        });

        it(`does NOT route ${name} to the image-rendering CodexAttachmentView`, () => {
            expect(routeSidebar(name)).not.toBe('CodexAttachmentView');
        });

        it(`does NOT route ${name} to the raw-JSON/base64 SidebarGenericView fallback`, () => {
            expect(routeSidebar(name)).not.toBe('SidebarGenericView');
        });
    }

    it('still falls through to SidebarGenericView for a tool in no allow-list (router fidelity)', () => {
        // Guards against a rigged router: an unmapped tool MUST still hit the generic path,
        // so the ImageToolFullView results above are meaningful (they pass only via the branch).
        expect(routeSidebar('functions.some_unmapped_tool')).toBe('SidebarGenericView');
    });

    it('routes the subagent lifecycle detail to its structured agent conversation, unchanged (AC4)', () => {
        expect(routeSidebar('functions.subagent_lifecycle')).toBe('SidebarAgentConversation');
    });
});

describe('Wave-1 Item 1 source-derived assertions (fail if the detail routing is reverted)', () => {
    it('routes image tools through an IMAGE_DETAIL_TOOLS branch to ImageToolFullView', () => {
        expect(sidebarSrc).toMatch(/if \(IMAGE_DETAIL_TOOLS\.has\(tool\.name\)\)\s*\{\s*return <ImageToolFullView/);
    });

    it('removed the old ATTACHMENT_TOOLS image-render allow-list', () => {
        // The predecessor cycles gated the image-render path on a local ATTACHMENT_TOOLS Set.
        // Wave-1 removed it; its reappearance signals a revert to the image-on-detail behavior.
        expect(sidebarSrc).not.toMatch(/ATTACHMENT_TOOLS\b/);
    });

    it('no longer renders or imports CodexAttachmentView (the image-render path is gone)', () => {
        expect(sidebarSrc).not.toMatch(/<CodexAttachmentView/);
        expect(sidebarSrc).not.toMatch(/import\s*\{[^}]*CodexAttachmentView[^}]*\}/);
    });

    it('imports the shared IMAGE_DETAIL_TOOLS source-of-truth set (parity with mobile registry + payload gate)', () => {
        expect(sidebarSrc).toMatch(/import \{ IMAGE_DETAIL_TOOLS \} from '@\/components\/tools\/views\/imageToolDetail'/);
    });
});

describe('Wave-1 Item 1 cross-surface parity (IMAGE_DETAIL_TOOLS routes the same on mobile detail)', () => {
    // The desktop sidebar and the mobile toolFullViewRegistry must route the SAME tool names to
    // the SAME text-only view, otherwise one surface could still leak an image. Every member of
    // IMAGE_DETAIL_TOOLS must map to ImageToolFullView in the mobile toolFullViewRegistry.
    function parseFullRegistry(): Record<string, string> {
        const m = registrySrc.match(/export const toolFullViewRegistry[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
        if (!m) throw new Error('toolFullViewRegistry block not found in _all.tsx');
        const map: Record<string, string> = {};
        for (const entry of m[1].matchAll(/(?:'([^']+)'|(\w+)):\s*(\w+)/g)) {
            map[entry[1] ?? entry[2]] = entry[3];
        }
        return map;
    }

    it('every IMAGE_DETAIL_TOOLS member routes to ImageToolFullView on mobile detail (no image leak on either surface)', () => {
        const registry = parseFullRegistry();
        for (const name of parseImageDetailTools()) {
            expect(registry[name]).toBe('ImageToolFullView');
        }
    });

    it('the three named image tools are all in IMAGE_DETAIL_TOOLS (incl. the previously-missing screenshot)', () => {
        const members = parseImageDetailTools();
        for (const name of NAMED_IMAGE_TOOLS) {
            expect(members).toContain(name);
        }
    });
});
