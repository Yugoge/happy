import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// RECONCILED to the authoritative user requirement (overrides the Wave-1 spec wording).
//
// DESKTOP right-sidebar detail for image tools MUST DISPLAY THE IMAGE (image only, no
// structured text). Clicking an image tool (functions.view_image, functions.image_generation,
// mcp__playwright__browser_take_screenshot, file, mcp__image_gen__imagegen, image_gen.imagegen)
// opens the rendered image via CodexAttachmentView in the right sidebar. Wave-1 had wrongly
// routed the desktop sidebar to the text-only ImageToolFullView; that was a misinterpretation
// and is reverted FOR THE DESKTOP SIDEBAR ONLY.
//
// The MOBILE full-detail page (toolFullViewRegistry in _all.tsx / ToolFullView.tsx) stays
// TEXT-ONLY and is intentionally left untouched — the cross-surface block below pins the mobile
// registry to ImageToolFullView on purpose (the text detail page is correct on mobile).
//
// SidebarContentRenderer.tsx transitively imports react-native / react-native-unistyles /
// expo, which cannot load in this node-env vitest (the same constraint documented in
// CodexSubagentLifecycleView.test.ts / codexToolRendering.test.ts). So this test combines
// (a) a GENUINE behavioral test of the sidebar routing precedence reconstructed faithfully
// from source, with (b) SOURCE-DERIVED assertions that FAIL if the desktop sidebar routing is
// reverted (e.g. re-pointing the image tools back to the text-only ImageToolFullView, or
// dropping the IMAGE_DETAIL_TOOLS branch so image tools fall through to the raw-JSON/base64
// SidebarGenericView).

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

describe('Desktop sidebar image-detail routing (behavioral, reconstructed from source)', () => {
    for (const name of NAMED_IMAGE_TOOLS) {
        it(`routes ${name} to the image-rendering CodexAttachmentView (image shown on desktop detail)`, () => {
            expect(routeSidebar(name)).toBe('CodexAttachmentView');
        });

        it(`does NOT route ${name} to the text-only ImageToolFullView (no text-only detail on desktop)`, () => {
            expect(routeSidebar(name)).not.toBe('ImageToolFullView');
        });

        it(`does NOT route ${name} to the raw-JSON/base64 SidebarGenericView fallback`, () => {
            expect(routeSidebar(name)).not.toBe('SidebarGenericView');
        });
    }

    it('still falls through to SidebarGenericView for a tool in no allow-list (router fidelity)', () => {
        // Guards against a rigged router: an unmapped tool MUST still hit the generic path,
        // so the CodexAttachmentView results above are meaningful (they pass only via the branch).
        expect(routeSidebar('functions.some_unmapped_tool')).toBe('SidebarGenericView');
    });

    it('routes the subagent lifecycle detail to its structured agent conversation, unchanged (AC4)', () => {
        expect(routeSidebar('functions.subagent_lifecycle')).toBe('SidebarAgentConversation');
    });
});

describe('Desktop sidebar source-derived assertions (fail if the detail routing is reverted)', () => {
    it('routes image tools through an IMAGE_DETAIL_TOOLS branch to CodexAttachmentView', () => {
        expect(sidebarSrc).toMatch(/if \(IMAGE_DETAIL_TOOLS\.has\(tool\.name\)\)\s*\{\s*return <CodexAttachmentView/);
    });

    it('does NOT route the image tools to the text-only ImageToolFullView in the sidebar (revert guard)', () => {
        // Reverting the desktop sidebar to the text-only detail view would re-introduce this branch.
        expect(sidebarSrc).not.toMatch(/return <ImageToolFullView/);
    });

    it('does NOT import the text-only ImageToolFullView into the sidebar renderer (revert guard)', () => {
        expect(sidebarSrc).not.toMatch(/import\s*\{[^}]*ImageToolFullView[^}]*\}/);
    });

    it('renders and imports CodexAttachmentView (the image-render path on desktop detail)', () => {
        expect(sidebarSrc).toMatch(/<CodexAttachmentView/);
        expect(sidebarSrc).toMatch(/import \{ CodexAttachmentView \} from '@\/components\/tools\/views\/CodexAttachmentView'/);
    });

    it('imports the shared IMAGE_DETAIL_TOOLS source-of-truth set (still the single name source)', () => {
        expect(sidebarSrc).toMatch(/import \{ IMAGE_DETAIL_TOOLS \} from '@\/components\/tools\/views\/imageToolDetail'/);
    });
});

describe('Cross-surface: the MOBILE full-detail page stays text-only (intentionally untouched)', () => {
    // The desktop sidebar shows the IMAGE; the mobile toolFullViewRegistry keeps the TEXT-ONLY
    // ImageToolFullView. This is by design per the user requirement — the two surfaces diverge.
    // This block pins the mobile registry so an accidental edit to the mobile detail page (which
    // this task must NOT touch) is caught.
    function parseFullRegistry(): Record<string, string> {
        const m = registrySrc.match(/export const toolFullViewRegistry[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
        if (!m) throw new Error('toolFullViewRegistry block not found in _all.tsx');
        const map: Record<string, string> = {};
        for (const entry of m[1].matchAll(/(?:'([^']+)'|(\w+)):\s*(\w+)/g)) {
            map[entry[1] ?? entry[2]] = entry[3];
        }
        return map;
    }

    it('every IMAGE_DETAIL_TOOLS member routes to the text-only ImageToolFullView on MOBILE detail', () => {
        const registry = parseFullRegistry();
        for (const name of parseImageDetailTools()) {
            expect(registry[name]).toBe('ImageToolFullView');
        }
    });

    it('the three named image tools are all in IMAGE_DETAIL_TOOLS (incl. the screenshot tool)', () => {
        const members = parseImageDetailTools();
        for (const name of NAMED_IMAGE_TOOLS) {
            expect(members).toContain(name);
        }
    });
});
