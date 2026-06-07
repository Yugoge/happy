import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    IMAGE_DETAIL_TOOLS,
    sanitizeImageToolInput,
    sanitizedInputJson,
    sanitizeImageToolText,
    deriveImageType,
    buildImageToolOutput,
} from './imageToolDetail';

// Wave-1 Item 1 (spec-20260607-124814 §2): the image-tool DETAIL page must be a
// Claude-Code-style text-only structure (Description → Input Params JSON → Output
// path/dimensions/type) — NO <Image>, NO raw base64 — on BOTH detail surfaces.
//
// ImageToolFullView.tsx transitively imports react-native / react-native-unistyles /
// expo, which cannot mount in this node-env vitest (same documented constraint as
// SidebarContentRenderer.test.ts / CodexAttachmentView.test.ts). So this combines
//   (a) GENUINE behavioral tests of the importable PURE functions (sanitizer / output
//       builder / type derivation), and
//   (b) SOURCE-DERIVED routing assertions reconstructed faithfully from source that
//       FAIL if any routing/suppression edit is reverted.

const VIEWS_DIR = resolve(__dirname);
const allSrc = readFileSync(resolve(VIEWS_DIR, '_all.tsx'), 'utf8');
const toolFullViewSrc = readFileSync(resolve(VIEWS_DIR, '../ToolFullView.tsx'), 'utf8');
const sidebarSrc = readFileSync(resolve(VIEWS_DIR, '../../sidebar/SidebarContentRenderer.tsx'), 'utf8');

const NAMED_IMAGE_TOOLS = [
    'functions.view_image',
    'mcp__playwright__browser_take_screenshot',
    'functions.image_generation',
];

// Parse the `toolFullViewRegistry` object block and return the component each tool name
// maps to. Mirrors the registry literal `'<name>': <Component>,`.
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

describe('AC5 mobile detail routing (toolFullViewRegistry, reconstructed from source)', () => {
    const registry = parseFullRegistry();
    for (const name of NAMED_IMAGE_TOOLS) {
        it(`routes ${name} to ImageToolFullView (NOT CodexAttachmentView) on mobile detail`, () => {
            expect(registry[name]).toBe('ImageToolFullView');
            expect(registry[name]).not.toBe('CodexAttachmentView');
        });
    }
    it('does NOT change the subagent_lifecycle detail route (AC4 — still AgentFullView)', () => {
        expect(registry['functions.subagent_lifecycle']).toBe('AgentFullView');
    });
});

describe('AC2 desktop detail routing (SidebarContentRenderer, reconstructed from source)', () => {
    // The desktop sidebar routes image tools via `if (IMAGE_DETAIL_TOOLS.has(tool.name))
    // return <ImageToolFullView ...`. Assert the branch exists and precedes the generic
    // fallback, and that the old CodexAttachmentView image branch is gone.
    it('routes image tools through an IMAGE_DETAIL_TOOLS branch to ImageToolFullView', () => {
        expect(sidebarSrc).toMatch(/if \(IMAGE_DETAIL_TOOLS\.has\(tool\.name\)\)\s*\{\s*return <ImageToolFullView/);
    });
    it('no longer renders or imports CodexAttachmentView (removed image-render path; comments aside)', () => {
        expect(sidebarSrc).not.toMatch(/<CodexAttachmentView/);
        expect(sidebarSrc).not.toMatch(/import\s*\{[^}]*CodexAttachmentView[^}]*\}/);
    });
    it('falls through to SidebarGenericView only for unmatched tools (router fidelity)', () => {
        expect(sidebarSrc).toMatch(/return <SidebarGenericView/);
    });
});

describe('AC1/AC3 payload-ownership suppression (ToolFullView, reconstructed from source)', () => {
    function parseSet(src: string, name: string): string {
        const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
        if (!m) throw new Error(`set ${name} not found`);
        return m[1];
    }
    it('image tools fully own the mobile payload (spreads IMAGE_DETAIL_TOOLS into SPECIALIZED_FULL_PAYLOAD_TOOLS)', () => {
        expect(parseSet(toolFullViewSrc, 'SPECIALIZED_FULL_PAYLOAD_TOOLS')).toMatch(/\.\.\.IMAGE_DETAIL_TOOLS/);
    });
    it('suppresses the generic Description for image-detail tools (no duplicate Description — codex F2)', () => {
        expect(toolFullViewSrc).toMatch(/!isImageDetailTool && <ToolDescriptionSection/);
    });
    it('suppresses the dev-mode Raw JSON dump for image-detail tools (base64 leak — codex F1)', () => {
        expect(toolFullViewSrc).toMatch(/!isImageDetailTool && <ToolRawJsonSection/);
    });
});

describe('IMAGE_DETAIL_TOOLS source-of-truth + parity across the three sites', () => {
    it('contains the three named image tools (+ screenshot that was previously missing)', () => {
        for (const name of NAMED_IMAGE_TOOLS) {
            expect(IMAGE_DETAIL_TOOLS.has(name)).toBe(true);
        }
    });
    it('does NOT contain subagent_lifecycle (its structured detail is preserved — AC4)', () => {
        expect(IMAGE_DETAIL_TOOLS.has('functions.subagent_lifecycle')).toBe(false);
    });
    it('every IMAGE_DETAIL_TOOLS member is routed to ImageToolFullView in the mobile registry (parity)', () => {
        const registry = parseFullRegistry();
        for (const name of IMAGE_DETAIL_TOOLS) {
            expect(registry[name]).toBe('ImageToolFullView');
        }
    });
});

describe('AC3 output builder is an allowlisted {path, dimensions, type} (never previewUri)', () => {
    it('derives path + dimensions + extension type from input/result', () => {
        const out = buildImageToolOutput(
            { path: '/tmp/shot.png', image: { width: 1920, height: 1080 } },
            { path: '/tmp/shot.png' },
        );
        expect(out).toEqual({ path: '/tmp/shot.png', dimensions: '1920×1080', type: 'PNG' });
    });
    it('returns ONLY the three allowlisted keys (no previewUri / size / label leakage)', () => {
        const out = buildImageToolOutput(
            { path: '/tmp/a.jpg', preview_uri: 'data:image/jpeg;base64,QUJD', size: 12345 },
            { b64_json: 'QUJDREVG' },
        );
        expect(Object.keys(out).sort()).toEqual(['dimensions', 'path', 'type']);
        expect(JSON.stringify(out)).not.toMatch(/data:image/);
        expect(JSON.stringify(out)).not.toContain('QUJD');
    });
    it('returns null type for a missing/unrecognized extension (caller renders i18n unknown)', () => {
        expect(deriveImageType(null)).toBeNull();
        expect(deriveImageType('/tmp/file.xyz')).toBeNull();
        expect(deriveImageType('/tmp/p.webp')).toBe('WebP');
    });
    // codex finding 2: path/dimensions come from RAW input fields and could carry base64.
    it('rejects a data:image / base64 blob smuggled into the path field (no leak in Output)', () => {
        const out = buildImageToolOutput({ ref: 'data:image/png;base64,iVBORw0KGgoAAAA' }, {});
        expect(out.path).toBeNull();
        expect(out.type).toBeNull();
        expect(JSON.stringify(out)).not.toMatch(/data:image/);
        expect(JSON.stringify(out)).not.toContain('iVBORw0KGgo');
    });
    it('rejects a bare long base64 blob (no separators, >64 chars) as a path', () => {
        const blob = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5YWJjZGVmZ2hpamtsbW5vcA';
        expect(blob.length).toBeGreaterThan(64);
        const out = buildImageToolOutput({ path: blob }, {});
        expect(out.path).toBeNull();
    });
    it('only accepts a strict numeric NxN dimensions string', () => {
        const good = buildImageToolOutput({ path: '/a.png', width: 12, height: 34 }, {});
        expect(good.dimensions).toBe('12×34');
    });
});

describe('codex finding 1: free-text (description) data:image redaction', () => {
    it('redacts a data:image data-URI embedded in description text', () => {
        const out = sanitizeImageToolText('icon: data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', 'X');
        expect(out).not.toContain('iVBORw0KGgo');
        expect(out).toContain('X');
    });
    it('leaves plain description text untouched', () => {
        expect(sanitizeImageToolText('Read the image at /tmp/x.png', 'X')).toBe('Read the image at /tmp/x.png');
    });
});

describe('codex finding 3: broadened data:image redaction (params / case / whitespace)', () => {
    it('redacts a data:image with a MIME parameter before ;base64', () => {
        const json = sanitizedInputJson({ note: 'data:image/svg+xml;charset=utf-8;base64,PHN2Zz48L3N2Zz4=' });
        expect(json).not.toContain('PHN2Zz48L3N2Zz4=');
    });
    it('redacts an uppercase BASE64 token', () => {
        const out = sanitizeImageToolText('data:image/PNG;BASE64,QUJDREVGR0hJSg==', 'X');
        expect(out).not.toContain('QUJDREVGR0hJSg==');
    });
    it('redacts a multiline base64 payload fully (not just the prefix)', () => {
        const multiline = 'data:image/png;base64,iVBORw0KGgo\nAAAANSUhEUg\nAAAAEAAAAB';
        const out = sanitizeImageToolText(multiline, 'X');
        expect(out).not.toContain('AAAANSUhEUg');
        expect(out).not.toContain('AAAAEAAAAB');
    });
});

describe('AC1/AC3 input sanitizer strips ALL known base64 shapes before stringify', () => {
    it('drops a top-level base64 key value', () => {
        const json = sanitizedInputJson({ image: { data: 'QUJDREVGSElKS0xNTk9Q', mimeType: 'image/png' } });
        expect(json).not.toContain('QUJDREVGSElKS0xNTk9Q');
        // structure preserved, key kept with a redaction marker
        expect(json).toMatch(/"data"/);
        expect(json).toMatch(/image\/png/);
    });
    it('strips b64_json and image_base64 / imageBase64 keys at any depth', () => {
        const json = sanitizedInputJson({
            b64_json: 'AAAA1111',
            nested: { image_base64: 'BBBB2222', deeper: { imageBase64: 'CCCC3333' } },
        });
        for (const blob of ['AAAA1111', 'BBBB2222', 'CCCC3333']) {
            expect(json).not.toContain(blob);
        }
    });
    it('strips nested contentItems[].data (the replay-child shape with no top-level preview_uri)', () => {
        const json = sanitizedInputJson({
            contentItems: [
                { type: 'text', text: 'hello' },
                { type: 'image', data: 'DEADBEEFDEADBEEFDEADBEEF', mimeType: 'image/png' },
            ],
        });
        expect(json).not.toContain('DEADBEEFDEADBEEFDEADBEEF');
        expect(json).toContain('hello');
    });
    it('redacts a data:image/...;base64,... value carried in preview_uri / url / uri', () => {
        const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
        const json = sanitizedInputJson({ preview_uri: dataUri, url: dataUri, uri: dataUri });
        expect(json).not.toContain('iVBORw0KGgo');
        expect(json).not.toMatch(/data:image\/png;base64,[A-Za-z0-9+/=]{8,}/);
    });
    it('redacts a data:image data-URI embedded in an arbitrary string value', () => {
        const out = sanitizeImageToolInput({
            note: 'see data:image/gif;base64,R0lGODlhAQABAAAAACw= for the icon',
        }) as { note: string };
        expect(out.note).not.toContain('R0lGODlhAQABAAAAACw=');
    });
    it('preserves non-binary input values verbatim (no over-redaction)', () => {
        const out = sanitizeImageToolInput({ path: '/tmp/x.png', width: 10, height: 20, name: 'shot' });
        expect(out).toEqual({ path: '/tmp/x.png', width: 10, height: 20, name: 'shot' });
    });
});
