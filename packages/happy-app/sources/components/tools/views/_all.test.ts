import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard (task: restore Bash/Edit DETAIL registry entries).
//
// _all.tsx transitively imports react-native / react-native-unistyles / expo via
// the view components, which cannot mount in this node-env vitest (same documented
// constraint as ImageToolFullView.test.ts / CodexAttachmentView.test.ts). So we
// reconstruct `toolFullViewRegistry` + `getToolFullViewComponent` faithfully from
// the _all.tsx SOURCE and assert the lookup-by-name semantics. These assertions
// FAIL if the `Bash: BashViewFull` / `Edit: EditViewFull` entries are dropped again.

const VIEWS_DIR = resolve(__dirname);
const allSrc = readFileSync(resolve(VIEWS_DIR, '_all.tsx'), 'utf8');

// Parse the `toolFullViewRegistry` object literal and return the component name each
// tool name maps to. Mirrors the registry entries `'<name>': <Component>,` / `<name>: <Component>,`.
function parseFullRegistry(): Record<string, string> {
    const m = allSrc.match(/export const toolFullViewRegistry[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
    if (!m) throw new Error('toolFullViewRegistry block not found in _all.tsx');
    const body = m[1];
    const map: Record<string, string> = {};
    for (const entry of body.matchAll(/(?:'([^']+)'|(\w+)):\s*(\w+)/g)) {
        const key = entry[1] ?? entry[2];
        map[key] = entry[3];
    }
    return map;
}

// Faithful reconstruction of getToolFullViewComponent's lookup semantics
// (toolFullViewRegistry[toolName] || null), so the assertions below exercise the
// same name->component resolution the app uses on the ToolFullView path.
const fullRegistry = parseFullRegistry();
function getToolFullViewComponentName(toolName: string): string | null {
    return fullRegistry[toolName] ?? null;
}

describe('toolFullViewRegistry — Bash/Edit DETAIL view restoration (revert-sensitive)', () => {
    it('resolves Bash to BashViewFull (terminal detail view, not generic raw JSON)', () => {
        expect(getToolFullViewComponentName('Bash')).toBe('BashViewFull');
    });

    it('resolves Edit to EditViewFull (structured edit detail view, not generic raw JSON)', () => {
        expect(getToolFullViewComponentName('Edit')).toBe('EditViewFull');
    });

    it('imports BashViewFull and EditViewFull in _all.tsx (entries must use real components)', () => {
        expect(allSrc).toMatch(/import\s*\{\s*BashViewFull\s*\}\s*from\s*'\.\/BashViewFull'/);
        expect(allSrc).toMatch(/import\s*\{\s*EditViewFull\s*\}\s*from\s*'\.\/EditViewFull'/);
    });

    it('leaves the image-tool detail entries pointing at ImageToolFullView (text-only mobile detail)', () => {
        for (const name of [
            'functions.view_image',
            'functions.image_generation',
            'mcp__playwright__browser_take_screenshot',
            'file',
            'image_gen.imagegen',
            'mcp__image_gen__imagegen',
        ]) {
            expect(getToolFullViewComponentName(name)).toBe('ImageToolFullView');
        }
    });

    it('leaves the MultiEdit detail entry intact (MultiEditViewFull)', () => {
        expect(getToolFullViewComponentName('MultiEdit')).toBe('MultiEditViewFull');
    });
});
