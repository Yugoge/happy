import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/components/markdown/parseMarkdown';
import { parseUnifiedDiff } from './codexUnifiedDiff';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codexRenderFixtures } from '@/app/(app)/dev/codex-render-fixtures-data';
import {
    buildTerminalRenderData,
    buildGenericToolSummary,
    extractAttachmentSummary,
    extractPlanItems,
    extractToolUses,
    stringifyInspectableValue,
    summarizePlanItems,
    truncateInspectableText,
    shouldRenderToolContent,
    buildLifecycleSuppressionMap,
    isControlToolSuppressedByLifecycle,
    attachmentHasRenderableImagePreview,
    readImagePreviewUri,
    extractRequestUserInputUnavailableReason,
    extractRequestUserInputSummary,
    buildRequestUserInputFailureLineFromResult,
    CODEX_LIFECYCLE_TOOL,
} from './codexToolRendering';
import { normalizeRawMessage } from '@/sync/typesRaw';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import { createId } from '@paralleldrive/cuid2';

describe('codex rendering helpers', () => {
    it('keeps long terminal previews compact while preserving full output data', () => {
        const full = ['one', 'two', 'three', 'four'].join('\n');
        const terminal = buildTerminalRenderData(
            { command: ['/bin/bash', '-lc', 'printf lines'] },
            'completed',
            { stdout: full, stderr: '', exit_code: 0 },
            2,
        );

        expect(terminal.command).toBe('printf lines');
        expect(terminal.stdout).toBe('one\ntwo');
        expect(terminal.statusLine).toBe('exit 0');
        expect(terminal.extraLines).toBe(2);
    });

    it('parses protocol end payload strings so terminal status remains visible', () => {
        const terminal = buildTerminalRenderData(
            { command: 'run failing command' },
            'completed',
            JSON.stringify({
                output: 'stdout text',
                stderr: 'stderr text',
                exit_code: 2,
                status: 'declined',
            }),
        );

        expect(terminal.stdout).toBe('stdout text');
        expect(terminal.stderr).toBe('stderr text');
        expect(terminal.statusLine).toBe('exit 2 · status: declined');
    });

    it('surfaces stderr and nonzero exit information for terminal detail', () => {
        const terminal = buildTerminalRenderData(
            { parsed_cmd: [{ cmd: 'node failing-test.js' }] },
            'error',
            { stdout: 'partial', stderr: 'boom', exitCode: 2, status: 'failed' },
        );

        expect(terminal.command).toBe('node failing-test.js');
        expect(terminal.stdout).toBe('partial');
        expect(terminal.stderr).toBe('boom');
        expect(terminal.statusLine).toBe('exit 2 · status: failed');
    });

    it('covers patch and diff fixtures with full old/new text extraction', () => {
        const diff = [
            'diff --git a/app.ts b/app.ts',
            '--- a/app.ts',
            '+++ b/app.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');

        expect(parseUnifiedDiff(diff)).toEqual({
            fileName: 'app.ts',
            oldText: 'old',
            newText: 'new',
        });

        expect(parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new')).toMatchObject({
            oldText: 'old',
            newText: 'new',
        });
    });

    it('extracts plan/update, multi-tool, image, MCP/resource, and unknown previews', () => {
        const plan = extractPlanItems({
            plan: [
                { step: 'Inspect payload', status: 'completed' },
                { step: 'Render fallback', status: 'in_progress' },
            ],
        });
        const tools = extractToolUses({
            tool_uses: [
                { recipient_name: 'functions.exec_command', parameters: { cmd: 'pwd' } },
                { recipient_name: 'mcp__resources__read', parameters: { uri: 'file://fixture.md' } },
            ],
        });
        const attachment = extractAttachmentSummary({
            path: '/tmp/render-fixtures/plot.png',
            image: { width: 640, height: 480 },
            size: 2048,
        });
        const generatedImage = extractAttachmentSummary({}, JSON.stringify({
            path: '/tmp/generated.png',
            preview_uri: 'data:image/png;base64,abc',
        }));
        const preview = truncateInspectableText(
            stringifyInspectableValue(JSON.stringify({ nested: { value: ['unknown', { type: 'payload' }] } })),
            8,
            1200,
        );

        expect(summarizePlanItems(plan)).toBe('Plan: 2 steps (1 done, 1 active)');
        expect(tools[0]).toEqual({ name: 'functions.exec_command', summary: '{\n  "cmd": "pwd"\n}' });
        expect(tools[1]?.name).toBe('mcp__resources__read');
        expect(attachment).toMatchObject({
            label: 'plot.png',
            path: '/tmp/render-fixtures/plot.png',
            size: '2048 bytes',
            dimensions: '640×480',
        });
        expect(generatedImage).toMatchObject({
            path: '/tmp/generated.png',
            previewUri: 'data:image/png;base64,abc',
        });
        expect(preview.text).toContain('"payload"');
        expect(preview.truncated).toBe(true);
    });

    // B12 (G1): real image_gen payloads may carry the image as a data-URI or a
    // bare base64 blob under b64_json/data — not only an explicit preview_uri.
    // extractAttachmentSummary must broaden to recognize these.
    it('recognizes image previews from data-uri and base64 payloads (B12)', () => {
        const dataUri = extractAttachmentSummary({}, JSON.stringify({
            output_path: '/tmp/render-fixtures/generated-image.png',
            data: 'data:image/png;base64,iVBORw0KGgo=',
        }));
        expect(dataUri.previewUri).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(dataUri.path).toBe('/tmp/render-fixtures/generated-image.png');

        const bareB64 = 'A'.repeat(80);
        const b64Json = extractAttachmentSummary({}, JSON.stringify({
            b64_json: bareB64,
            mime_type: 'image/jpeg',
        }));
        expect(b64Json.previewUri).toBe(`data:image/jpeg;base64,${bareB64}`);

        // A text-Read result (no image signal) must NOT produce a preview.
        const textRead = extractAttachmentSummary(
            { file_path: '/src/index.ts' },
            JSON.stringify({ file: { filePath: '/src/index.ts', content: 'const a = 1;\n' } }),
        );
        expect(textRead.previewUri).toBeNull();

        // An image-extension Read whose result carries NO preview URI must NOT
        // report a renderable preview (codex F3 — gating Read.minimal on the
        // looser extension check would otherwise render an empty body).
        const imageRead = extractAttachmentSummary(
            { file_path: '/tmp/shot.png' },
            JSON.stringify({ file: { filePath: '/tmp/shot.png' } }),
        );
        expect(attachmentHasRenderableImagePreview(imageRead)).toBe(false);
    });

    // B05 R2 (codex F1): readImagePreviewUri is the ReadView gate. It must yield a
    // preview ONLY from a producer-emitted STRUCTURED OBJECT result; a string
    // result (a real text Read) — even one whose content is a JSON image data-URI
    // — must never render an image. (The shared extractAttachmentSummary still
    // parses string payloads for Codex's string-over-wire tools; this gate is
    // Read-specific so text Reads cannot regress.)
    it('resolves a Read preview only from an object result, never from a string (codex F1)', () => {
        // Producer-emitted object result → preview renders.
        const objResult = readImagePreviewUri(
            { file_path: '/tmp/shot.png' },
            { path: '/tmp/shot.png', preview_uri: 'data:image/png;base64,AAAB' },
        );
        expect(objResult).toBe('data:image/png;base64,AAAB');

        // Pathological text Read whose CONTENT is a JSON image data-URI string →
        // NO preview (the false-positive codex flagged).
        const stringResult = readImagePreviewUri(
            { file_path: '/tmp/notes.txt' },
            JSON.stringify({ preview_uri: 'data:image/png;base64,AAAB' }),
        );
        expect(stringResult).toBeNull();

        // Plain text Read → no preview.
        expect(readImagePreviewUri({ file_path: '/tmp/notes.txt' }, 'just text')).toBeNull();

        // Object result with no renderable image URI → no preview.
        expect(readImagePreviewUri({ file_path: '/tmp/notes.txt' }, { content: 'x' })).toBeNull();
    });

    // codex F1: real PNG/JPEG base64 routinely contains '/'. A trusted base64
    // field with an image mime hint must render even with '/' in the payload.
    it('accepts trusted base64 containing "/" when an image mime hint is present (codex F1)', () => {
        const b64WithSlash = 'iVBORw0KGg/oABBQ=='.repeat(5); // contains '/', len > 64
        const withSlash = extractAttachmentSummary({}, JSON.stringify({
            b64_json: b64WithSlash,
            media_type: 'image/png',
        }));
        expect(withSlash.previewUri).toBe(`data:image/png;base64,${b64WithSlash}`);

        // A long base64-shaped blob with NO image mime hint is NOT promoted to a
        // preview (it could be any binary/text blob, not an image).
        const noMime = extractAttachmentSummary({}, JSON.stringify({ data: 'Z'.repeat(120) }));
        expect(noMime.previewUri).toBeNull();
    });

    // codex F2: a non-image url/uri must NOT become a previewUri (it would render
    // a broken <Image>). Only data:image/* and http(s) URLs are accepted.
    it('does not promote a non-image url/uri to a preview (codex F2)', () => {
        const docLink = extractAttachmentSummary({}, JSON.stringify({ url: 'ftp://example.com/file' }));
        expect(docLink.previewUri).toBeNull();
        const nonImageDataUri = extractAttachmentSummary({}, JSON.stringify({ uri: 'data:text/plain;base64,SGk=' }));
        expect(nonImageDataUri.previewUri).toBeNull();
        // An http(s) image URL is still accepted.
        const httpImg = extractAttachmentSummary({}, JSON.stringify({ preview_uri: 'https://cdn/x.png' }));
        expect(httpImg.previewUri).toBe('https://cdn/x.png');
    });

    // AC-B12-3 (replay-child raw shape): the rolloutHistoryReplay.buildChildEndEnvelope
    // image_gen result has NO top-level preview_uri and NO flat base64 — the bytes are
    // nested in contentItems:[{type:'image',data,mimeType}]. The recursive recognizer
    // must find them so the replay surface still renders inline.
    it('recognizes a nested contentItems image (replay-child raw shape) — AC-B12-3', () => {
        const realPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFBQIAHl6u2QAAAABJRU5ErkJggg==';
        const replayRaw = extractAttachmentSummary({}, JSON.stringify({
            status: 'completed',
            contentItems: [{ type: 'image', data: realPng, mimeType: 'image/png' }],
        }));
        expect(replayRaw.previewUri).toBe(`data:image/png;base64,${realPng}`);

        // A nested NON-image content item must NOT be promoted to a preview.
        const replayText = extractAttachmentSummary({}, JSON.stringify({
            status: 'completed',
            content: [{ type: 'text', text: 'just a note' }],
        }));
        expect(replayText.previewUri).toBeNull();
    });

    // Doubly-encoded MCP screenshot shape (mcp__playwright__browser_take_screenshot):
    // result.content[0] is { type:'text', text:<a JSON STRING> }; that inner string,
    // when parsed, is { content:[ {type:'text',text:'x'}, {type:'image',data,mimeType} ] }.
    // The image lives behind a stringified-JSON wrapper, so the flat readValue + the
    // plain contentItems recursion both miss it. extractAttachmentSummary must parse
    // the wrapper and surface a non-empty previewUri (otherwise CodexAttachmentView
    // shows "image preview data unavailable" even though the PNG bytes are present).
    // Revert-sensitive: removing the JSON-string parse path in findNestedImageDataUri
    // makes previewUri null and this fails.
    it('recognizes an image inside a stringified-JSON wrapper (MCP screenshot shape)', () => {
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFBQIAHl6u2QAAAABJRU5ErkJggg==';
        const screenshotResult = {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        content: [
                            { type: 'text', text: 'x' },
                            { type: 'image', data: png, mimeType: 'image/png' },
                        ],
                    }),
                },
            ],
        };
        const summary = extractAttachmentSummary({}, screenshotResult);
        expect(summary.previewUri).toBe(`data:image/png;base64,${png}`);
        expect(attachmentHasRenderableImagePreview(summary)).toBe(true);

        // Negative control: the same wrapper carrying only a text item must NOT
        // synthesize a preview (the JSON-parse path must not false-positive).
        const textOnly = extractAttachmentSummary({}, {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        content: [{ type: 'text', text: 'just a note' }],
                    }),
                },
            ],
        });
        expect(textOnly.previewUri).toBeNull();
    });

    // AC-B12-1 (fixture honesty): the honest image_gen fixture's preview_uri MUST be
    // derived from its own contentItems base64. A disconnected placeholder preview_uri
    // unrelated to the contentItems bytes must NOT be the rendered preview — this test
    // FAILS if the fixture reverts to a fabricated/disconnected preview_uri.
    it('honest image_gen fixture derives preview_uri from its own contentItems base64 — AC-B12-1', () => {
        const fixture = codexRenderFixtures.find((f) => f.id === 'image-generation');
        expect(fixture).toBeTruthy();
        const result = fixture!.tool!.result as Record<string, any>;
        const items = result.contentItems as Array<{ data: string; mimeType: string }>;
        expect(Array.isArray(items) && items.length > 0).toBe(true);
        const derived = `data:${items[0].mimeType};base64,${items[0].data}`;
        // The fixture's declared top-level preview_uri equals the value DERIVED from
        // its own contentItems bytes (not a disconnected constant).
        expect(result.preview_uri).toBe(derived);
        // And the consumer recognizes exactly that derived URI from the fixture result.
        expect(extractAttachmentSummary(fixture!.tool!.input, result).previewUri).toBe(derived);
    });

    // AC4 (real-MCP-name): the LIVE producer emits image_gen as mcp__image_gen__imagegen
    // (sessionProtocolMapper.ts:903-904). This NON-VACUOUS test derives hasSpecializedView +
    // minimal from the REAL registry SOURCE (not hardcoded true,false) and proves the inline
    // image renders, with two negative controls proving both gates are real. A dot-form-only
    // path would NOT exercise the minimal=isMcp gate, so this asserts the genuine producer
    // surface. NOTE: the view-registry modules (_all.tsx, knownTools.tsx) transitively import
    // react-native/expo, which cannot load in this node-env vitest; deriving the flags from the
    // registry SOURCE is the honest registry-derived substitute — it FAILS if the registration
    // is removed, exactly like a runtime lookup would.
    it('renders the real MCP name mcp__image_gen__imagegen inline — registry-derived, with negative controls — AC4', () => {
        const MCP_NAME = 'mcp__image_gen__imagegen';
        const fixture = codexRenderFixtures.find((f) => f.id === 'image-generation-mcp-name');
        expect(fixture).toBeTruthy();
        expect(fixture!.tool!.name).toBe(MCP_NAME);
        const mcpTool = fixture!.tool!;

        // DERIVED FROM REAL WIRING (codex finding #4): hasSpecializedView from the actual
        // _all.tsx registry source, minimal from the actual knownTools.tsx entry — NOT hardcoded.
        const allSrc = readFileSync(resolve(__dirname, '../components/tools/views/_all.tsx'), 'utf8');
        const knownToolsSrc = readFileSync(resolve(__dirname, '../components/tools/knownTools.tsx'), 'utf8');
        // Wave-1 Item 1 (spec-20260607-124814): the INLINE card keeps CodexAttachmentView
        // (image renders inline) but the DETAIL/full view is now the text-only ImageToolFullView
        // (no image, no base64 leak). So the MCP name maps to CodexAttachmentView in the inline
        // block and to ImageToolFullView in the full block. Slice each registry object body so a
        // false-pass (both occurrences landing in one block or a comment) cannot occur — assert
        // the entry inside EACH block separately (codex ISSUE 1).
        const inlineBlock = /export const toolViewRegistry:[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(allSrc)?.[1] ?? '';
        const fullBlock = /export const toolFullViewRegistry:[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(allSrc)?.[1] ?? '';
        const attachmentEntry = new RegExp(`'${MCP_NAME}':\\s*CodexAttachmentView`);
        const imageDetailEntry = new RegExp(`'${MCP_NAME}':\\s*ImageToolFullView`);
        expect(attachmentEntry.test(inlineBlock)).toBe(true);   // inline ToolView card (image)
        // Revert-sensitive: detail routes to the text-only ImageToolFullView, NOT the image
        // renderer. If a revert re-points the full registry back to CodexAttachmentView this fails.
        expect(imageDetailEntry.test(fullBlock)).toBe(true);    // detail/full view (text-only)
        expect(attachmentEntry.test(fullBlock)).toBe(false);    // detail must NOT render the image
        const derivedHasSpecializedView = attachmentEntry.test(inlineBlock);
        // minimal ⇔ the knownTools entry for the MCP name declares minimal:false.
        const knownEntry = new RegExp(`'${MCP_NAME}':\\s*\\{[\\s\\S]*?minimal:\\s*(true|false)`).exec(knownToolsSrc);
        const derivedMinimal = knownEntry ? knownEntry[1] === 'true' : true; // absent → isMcp default true
        // Prove the wiring actually supplies the values the positive assertion depends on.
        expect(derivedHasSpecializedView).toBe(true);
        expect(derivedMinimal).toBe(false);

        // POSITIVE: with the registry-derived flags, the inline content renders.
        expect(shouldRenderToolContent(mcpTool, derivedHasSpecializedView, derivedMinimal)).toBe(true);
        // POSITIVE: the nested contentItems image is recognized as a renderable preview AND the
        // preview is DERIVED from the nested contentItems (no top-level preview_uri), proving the
        // findNestedImageDataUri recursion is the load-bearing path (codex ISSUE 2 — anti-false-pass).
        const result = mcpTool.result as Record<string, any>;
        expect(result.preview_uri).toBeUndefined();
        expect(result.previewUri).toBeUndefined();
        const item = result.contentItems?.[0];
        expect(item).toMatchObject({ type: 'image', mimeType: 'image/png' });
        const summary = extractAttachmentSummary(mcpTool.input, mcpTool.result);
        expect(summary.previewUri).toBe(`data:${item.mimeType};base64,${item.data}`);
        expect(attachmentHasRenderableImagePreview(summary)).toBe(true);

        // NEGATIVE CONTROL 1: minimal=true → suppressed at codexToolRendering.ts:162.
        expect(shouldRenderToolContent(mcpTool, true, true)).toBe(false);
        // NEGATIVE CONTROL 2: hasSpecializedView=false & minimal=false → chip-only gate at
        // line 164 fires for the mcp__* name. Proves registration (not the name alone) is load-bearing.
        expect(shouldRenderToolContent(mcpTool, false, false)).toBe(false);
    });

    // AC1/AC7 (sidebar routing) — RECONCILED for Wave-1 Item 1 (spec-20260607-124814):
    // The user's binding decision: clicking an image tool opens the RENDERED IMAGE on the desktop
    // right-sidebar detail (CodexAttachmentView). An earlier cycle wrongly re-pointed this to the
    // text-only ImageToolFullView; that was a misinterpretation and was reversed back to
    // CodexAttachmentView, gated by the shared IMAGE_DETAIL_TOOLS Set (imageToolDetail.ts) — never
    // the text-only ImageToolFullView, never the SidebarGenericView JSON/base64 fallback. The old
    // ATTACHMENT_TOOLS Set was removed. Registry-derived from the actual SidebarContentRenderer.tsx
    // + imageToolDetail.ts source so it FAILS if a revert re-introduces the text-only path on the
    // desktop sidebar. (The MOBILE full-detail registry stays ImageToolFullView by design — see the
    // AC4 test above and _all.test.ts; the two surfaces diverge intentionally.)
    it('routes both image_gen aliases to the image-rendering CodexAttachmentView on desktop detail (not text-only ImageToolFullView, not SidebarGenericView) — AC1/AC7', () => {
        const sidebarSrc = readFileSync(resolve(__dirname, '../components/sidebar/SidebarContentRenderer.tsx'), 'utf8');
        const imageDetailSrc = readFileSync(resolve(__dirname, '../components/tools/views/imageToolDetail.ts'), 'utf8');
        // The aliases live in the shared IMAGE_DETAIL_TOOLS source-of-truth Set.
        const setMatch = /export const IMAGE_DETAIL_TOOLS = new Set<string>\(\[([\s\S]*?)\]\)/.exec(imageDetailSrc);
        expect(setMatch).toBeTruthy();
        const members = setMatch![1];
        expect(members).toContain("'mcp__image_gen__imagegen'");
        expect(members).toContain("'image_gen.imagegen'");
        // The desktop sidebar routes IMAGE_DETAIL_TOOLS members to the image-rendering CodexAttachmentView.
        expect(/if \(IMAGE_DETAIL_TOOLS\.has\(tool\.name\)\)\s*\{\s*return <CodexAttachmentView/.test(sidebarSrc)).toBe(true);
        // Revert guard: the text-only ImageToolFullView is NOT used on the desktop sidebar.
        expect(sidebarSrc).not.toMatch(/<ImageToolFullView/);
        expect(sidebarSrc).not.toMatch(/ATTACHMENT_TOOLS\b/);
    });

    it('parses markdown/rich Codex text primitives without flattening', () => {
        const blocks = parseMarkdown([
            '# Heading',
            '- [x] done',
            '> quoted ~~old~~ [link](https://example.com)',
            '`code` &lt;tag&gt; $x + y$',
        ].join('\n'));

        expect(blocks.map((block) => block.type)).toEqual(['header', 'task-list', 'blockquote', 'text']);
        const textBlock = blocks[3];
        expect(textBlock?.type).toBe('text');
        if (textBlock?.type !== 'text') throw new Error('Expected final text block');
        expect(textBlock.content.some((span) => span.styles.includes('code') && span.text === 'code')).toBe(true);
        expect(textBlock.content.some((span) => span.text.includes('<tag>'))).toBe(true);
        expect(textBlock.content.some((span) => span.latex && span.text === 'x + y')).toBe(true);
    });

    it('keeps every QA Codex fixture row reachable by stable UI identifiers', () => {
        expect(codexRenderFixtures.map((fixture) => fixture.id)).toEqual([
            'qa-b06b07b08',
            'markdown-rich-detail',
            'terminal-stdout-stderr-exit',
            'patch-unified-diff',
            'update-plan',
            'parallel-tools',
            'image-view',
            'playwright-screenshot',
            'image-generation',
            'image-generation-replay-raw',
            'image-generation-mcp-name',
            'claude-read-image',
            'claude-read-text',
            'subagent-spawn',
            'subagent-wait',
            'subagent-close',
            'subagent-lifecycle-merged',
            'subagent-lifecycle-errored-summary',
            'subagent-lifecycle-errored-no-summary',
            'request-user-input-unavailable',
            'web-search',
            'web-weather',
            'web-open',
            'web-time',
            'web-finance',
            'web-sports',
            'playwright-data-url',
            'image-stale-no-preview',
            'pty-write-stdin',
            'mcp-resource-list-empty',
            'mcp-resource-templates-empty',
            'mcp-resource-read',
            'unknown-future-tool',
        ]);
        for (const fixture of codexRenderFixtures) {
            expect(fixture.matrix.userToolToken).toBeTruthy();
            expect(fixture.matrix.rendererToolKey).toBeTruthy();
            expect(fixture.matrix.classification).toMatch(/success|partial|failure|unavailable|unverified/);
        }
        const expectedStrings = codexRenderFixtures.flatMap((fixture) => [
            ...fixture.expectedVisibleStrings.inline,
            ...fixture.expectedVisibleStrings.detail,
            ...(fixture.expectedVisibleStrings.sidebar ?? []),
        ]);
        const screenshotFixture = codexRenderFixtures.find((fixture) => fixture.id === 'playwright-screenshot');
        expect(screenshotFixture?.matrix).toMatchObject({
            userToolToken: 'mcp__playwright__.browser_take_screenshot',
            rendererToolKey: 'mcp__playwright__browser_take_screenshot',
        });
        const terminalFixture = codexRenderFixtures.find((fixture) => fixture.id === 'terminal-stdout-stderr-exit');
        expect(terminalFixture?.tool?.description).toBe('/bin/bash -lc "printf codex-rendering-stdout; printf codex-rendering-stderr >&2"');
        expect(expectedStrings).toContain('exit 7');
        expect(expectedStrings).toContain('No MCP resources returned');
        expect(expectedStrings).toContain('No MCP resource templates returned');
        expect(expectedStrings).toContain('request_user_input is only available in Plan mode');
        expect(expectedStrings).toContain('Example result title');
        expect(expectedStrings).toContain('user rejected MCP tool call');
        expect(expectedStrings).toContain('payload');
    });

    it('summarizes generic Codex fallback tools without exposing raw JSON inline', () => {
        const mcpEmpty = buildGenericToolSummary(
            makeToolCall('functions.list_mcp_resources', { server: 'Codex' }, { resources: [] })
        );
        const webSearch = buildGenericToolSummary(
            makeToolCall('web.search_query', { search_query: [{ q: 'rendering' }] }, {
                results: [{ title: 'Example result title', url: 'https://example.com', snippet: 'Short source snippet' }],
            })
        );
        const unavailable = buildGenericToolSummary(
            makeToolCall('functions.request_user_input', { question: 'Pick one' }, {
                status: 'unavailable',
                error: 'request_user_input is only available in Plan mode',
            }, 'error')
        );

        expect(mcpEmpty.lines).toContain('No MCP resources returned');
        expect(webSearch.lines.join('\n')).toContain('Example result title');
        expect(webSearch.lines.join('\n')).not.toContain('{');
        expect(unavailable.lines.join('\n')).toContain('request_user_input is only available in Plan mode');
        expect(unavailable.detailsHint).toBe('Raw input/output available in details');
    });

    it('B11: failed request_user_input surfaces the error INLINE for both payload shapes (tags stripped)', () => {
        // (a) string <tool_use_error> payload: resultRecord is null, so the old
        // object-only extraction skipped it. The scoped branch must still surface
        // the UNWRAPPED message (no literal <tool_use_error> markup).
        const stringPayload = buildGenericToolSummary(
            makeToolCall('functions.request_user_input',
                { question: 'Pick one' },
                '<tool_use_error>request_user_input is unavailable in Default mode</tool_use_error>',
                'error'),
        );
        expect(stringPayload.lines.join('\n')).toContain('request_user_input is unavailable in Default mode');
        expect(stringPayload.lines.join('\n')).not.toContain('<tool_use_error>');

        // (b) structured-object payload: read stderr ?? error ?? message ?? reason,
        // tag-stripped if the field itself wraps a <tool_use_error>.
        const objPayload = buildGenericToolSummary(
            makeToolCall('functions.request_user_input',
                { question: 'Pick one' },
                { error: '<tool_use_error>stderr boom</tool_use_error>' },
                'error'),
        );
        expect(objPayload.lines.join('\n')).toContain('stderr boom');
        expect(objPayload.lines.join('\n')).not.toContain('<tool_use_error>');
        // No duplicate line for the same extracted message.
        expect(objPayload.lines.filter((l) => l.includes('stderr boom')).length).toBe(1);

        // stderr is preferred over error when both present.
        const stderrPref = buildGenericToolSummary(
            makeToolCall('functions.request_user_input', {},
                { stderr: 'from-stderr', error: 'from-error' }, 'error'),
        );
        expect(stderrPref.lines.join('\n')).toContain('from-stderr');

        // codex G3: a multi-line stderr keeps its line breaks (NOT collapsed to one
        // 160-char summary line) so the actionable lines remain visible inline.
        const multiline = buildGenericToolSummary(
            makeToolCall('functions.request_user_input', {},
                '<tool_use_error>line one\nline two\nline three</tool_use_error>', 'error'),
        );
        expect(multiline.lines.join('\n')).toContain('line one\nline two\nline three');

        // codex G3: a failed call with NO error text (result null/omitted) still
        // shows a scoped failure line inline — never an empty body (worse than
        // header-only).
        const nullResult = buildGenericToolSummary(
            makeToolCall('functions.request_user_input', { question: 'q' }, null, 'error'),
        );
        expect(nullResult.lines.length).toBeGreaterThan(0);
        expect(nullResult.lines.join('\n')).toContain('Request user input failed with no error output');
        const omittedResult = buildGenericToolSummary(
            makeToolCall('functions.request_user_input', { question: 'q' }, undefined, 'error'),
        );
        expect(omittedResult.lines.length).toBeGreaterThan(0);
        expect(omittedResult.lines.join('\n')).toContain('Request user input failed with no error output');
    });

    it('B11: shouldRenderToolContent renders the failed request_user_input body despite forced minimal, scoped to exactly that tool+state', () => {
        // The failed tool bypasses the minimal-gate (ToolView force-sets minimal=true
        // for a <tool_use_error> payload) so the inline error is reachable.
        const failed = makeToolCall('functions.request_user_input', {}, '<tool_use_error>x</tool_use_error>', 'error');
        expect(shouldRenderToolContent(failed, false, true)).toBe(true);

        // Non-error request_user_input still renders header-only (exception gated on error).
        const running = makeToolCall('functions.request_user_input', { question: 'q' }, undefined, 'running');
        expect(shouldRenderToolContent(running, false, true)).toBe(false);
        const completed = makeToolCall('functions.request_user_input', {}, { answer: 'ok' }, 'completed');
        expect(shouldRenderToolContent(completed, false, true)).toBe(false);

        // Regression (codex F5): a DIFFERENT minimal tool in an error state still
        // renders header-only — the exception must not widen beyond this tool.
        const otherErrorMinimal = makeToolCall('CodexPatch', {}, '<tool_use_error>diff failed</tool_use_error>', 'error');
        expect(shouldRenderToolContent(otherErrorMinimal, true, true)).toBe(false);
    });

    it('AC6: COMPLETED request_user_input with the Default-mode unavailable output renders inline (guard extended, error-state + empty-completed unchanged)', () => {
        // Captured tier-1 live shape (~/.codex rollout): request_user_input invoked
        // OUTSIDE Plan mode arrives as a COMPLETED function_call_output whose output
        // is the plain string 'request_user_input is unavailable in Default mode'
        // (NOT state==='error'). The :158 guard fired only for state==='error', so
        // the minimal-gate suppressed this completed-unavailable result → no card.
        const completedUnavailable = makeToolCall(
            'functions.request_user_input',
            { questions: [{ id: 'render_choice', header: 'Render', question: 'This is a request_user_input real rendering test' }] },
            'request_user_input is unavailable in Default mode',
            'completed',
        );
        // (a) The extended guard renders the body despite the registry minimal:true.
        expect(shouldRenderToolContent(completedUnavailable, false, true)).toBe(true);
        // (b) The summary surfaces the unavailable message (CJK question must not break it).
        const summary = buildGenericToolSummary(completedUnavailable);
        expect(summary.lines.join('\n')).toContain('request_user_input is unavailable in Default mode');

        // Structured-object completed-unavailable shape (error/message/reason carries the signal).
        const completedUnavailableObj = makeToolCall(
            'functions.request_user_input',
            { question: 'Pick one' },
            { status: 'unavailable', error: 'request_user_input is only available in Plan mode' },
            'completed',
        );
        expect(shouldRenderToolContent(completedUnavailableObj, false, true)).toBe(true);

        // NO-REGRESSION 1 (minimal gate for genuinely-empty completed tools): a normal
        // completed request_user_input answer still renders header-only (must stay false).
        const completedOk = makeToolCall('functions.request_user_input', {}, { answer: 'ok' }, 'completed');
        expect(shouldRenderToolContent(completedOk, false, true)).toBe(false);
        // A completed request_user_input with no result is still header-only.
        const completedEmpty = makeToolCall('functions.request_user_input', { question: 'q' }, undefined, 'completed');
        expect(shouldRenderToolContent(completedEmpty, false, true)).toBe(false);

        // NO-REGRESSION 2 (existing state==='error' branch): unchanged.
        const failed = makeToolCall('functions.request_user_input', {}, '<tool_use_error>x</tool_use_error>', 'error');
        expect(shouldRenderToolContent(failed, false, true)).toBe(true);

        // NO-REGRESSION 3 (scope): the extended guard must NOT widen to other tools — a
        // different completed minimal tool whose result happens to contain 'unavailable'
        // stays header-only.
        const otherCompleted = makeToolCall('CodexPatch', {}, 'service unavailable', 'completed');
        expect(shouldRenderToolContent(otherCompleted, true, true)).toBe(false);

        // codex review — FALSE-NEGATIVE guard: the captured live shape can carry the
        // message under `output` while a leading `status:'completed'` field is present.
        // The predicate must scan ALL fields (.some), not stop at the first non-null one.
        const fieldMasked = makeToolCall(
            'functions.request_user_input',
            { question: 'q' },
            { status: 'completed', output: 'request_user_input is unavailable in Default mode' },
            'completed',
        );
        expect(shouldRenderToolContent(fieldMasked, false, true)).toBe(true);
        // Same shape delivered as a JSON string (parseProtocolResult must parse it).
        const fieldMaskedString = makeToolCall(
            'functions.request_user_input',
            { question: 'q' },
            JSON.stringify({ status: 'completed', output: 'request_user_input is unavailable in Default mode' }),
            'completed',
        );
        expect(shouldRenderToolContent(fieldMaskedString, false, true)).toBe(true);

        // codex review — FALSE-POSITIVE guard: a LEGITIMATE completed answer whose text
        // merely contains the bare words 'unavailable'/'only available' (with NO mode /
        // tool-name context) must stay header-only. Mode-context anchoring prevents it.
        const benignAnswer = makeToolCall(
            'functions.request_user_input', {}, "I'm only available Friday and unavailable tomorrow", 'completed',
        );
        expect(shouldRenderToolContent(benignAnswer, false, true)).toBe(false);
        const benignSummary = buildGenericToolSummary(benignAnswer);
        // The benign answer still surfaces normally via the non-minimal path; here we
        // only assert the unavailable-card guard does NOT mis-fire on it.
        expect(benignSummary).toBeDefined();
    });

    it('renders Codex-sourced generic / unknown / resource tools inline (S2 forward fix; Cycle 7 M5 #17 chip-only gate)', () => {
        // Cycle 7 (M5 #17): MCP-namespace tools (mcp__* and functions.list_mcp_*)
        // now render chip-only unless a specialized view exists. The two assertions
        // below FLIP from true to false vs the original Cycle 6 baseline.
        const listResources = makeToolCall('functions.list_mcp_resources', { server: 'Codex' }, { resources: [] });
        expect(shouldRenderToolContent(listResources, false, true)).toBe(false);
        const mcpRead = makeToolCall('mcp__resources__read', { uri: 'file://fixture.md' }, { resources: [] });
        expect(shouldRenderToolContent(mcpRead, false, true, { flavor: 'codex' } as any)).toBe(false);
        // AC2 fix (Cycle 8): minimal=true now suppresses content regardless of hasSpecializedView.
        // CodexPatch (minimal=true) must not render body to avoid duplicate file-diff icons.
        expect(shouldRenderToolContent(mcpRead, true, true, { flavor: 'codex' } as any)).toBe(false);
        // Codex source tools render when minimal=false (original non-minimal behavior preserved).
        const futureTool = makeToolCall('functions.future_tool', { nested: { value: ['x'] } }, { error: 'user rejected MCP tool call' }, 'error');
        expect(shouldRenderToolContent(futureTool, false, false)).toBe(true);
        const webSearch = makeToolCall('web.search_query', { q: 'rendering' }, { results: [] });
        expect(shouldRenderToolContent(webSearch, false, true)).toBe(false);
        const codexBash = makeToolCall('CodexBash', {});
        expect(shouldRenderToolContent(codexBash, true, true)).toBe(false);
        const subagentControl = makeToolCall('functions.wait_agent', { name: 'fixture-agent' }, { status: 'completed' });
        expect(shouldRenderToolContent(subagentControl, true, true)).toBe(false);
        // Explicit MCP function tool guards: list_mcp_resource_templates + read_mcp_resource → chip-only.
        const listTemplates = makeToolCall('functions.list_mcp_resource_templates', {}, { templates: [] });
        expect(shouldRenderToolContent(listTemplates, false, true)).toBe(false);
        const readResource = makeToolCall('functions.read_mcp_resource', { uri: 'file://fixture.md' }, { content: 'x' });
        expect(shouldRenderToolContent(readResource, false, true)).toBe(false);
    });

    // Cycle 6 — D.5 subagent lifecycle suppression Map.
    it('builds a sessionSubagent → messageId Map from lifecycle envelopes and suppresses control cards by sessionSubagent (default-not-suppress fail-safe)', () => {
        const sessionSubagent = 'codex-fixture-subagent';
        const lifecycleMessage: any = {
            id: 'msg-lifecycle-1', kind: 'tool-call', children: [], localId: null, createdAt: 0,
            tool: makeToolCall(CODEX_LIFECYCLE_TOOL, { sessionSubagent, prompt: 'do work' }, { lifecycle_state: 'completed' }),
        };
        const spawnMessage: any = {
            id: 'msg-spawn-1', kind: 'tool-call', children: [], localId: null, createdAt: 0,
            tool: makeToolCall('functions.spawn_agent', { sessionSubagent, prompt: 'do work' }, { status: 'completed' }),
        };
        const waitMessage: any = {
            id: 'msg-wait-1', kind: 'tool-call', children: [], localId: null, createdAt: 0,
            tool: makeToolCall('functions.wait_agent', { sessionSubagent }, { status: 'completed' }),
        };
        const map = buildLifecycleSuppressionMap([lifecycleMessage, spawnMessage, waitMessage]);
        expect(map.size).toBe(1);
        expect(map.get(sessionSubagent)).toBe('msg-lifecycle-1');
        expect(isControlToolSuppressedByLifecycle(spawnMessage.tool, map)).toBe(true);
        expect(isControlToolSuppressedByLifecycle(waitMessage.tool, map)).toBe(true);
        expect(isControlToolSuppressedByLifecycle(lifecycleMessage.tool, map)).toBe(false); // lifecycle itself not suppressed
        // Default-not-suppress fail-safe: empty Map → no suppression
        expect(isControlToolSuppressedByLifecycle(spawnMessage.tool, new Map())).toBe(false);
        // Different sessionSubagent → no suppression
        const otherSpawn = makeToolCall('functions.spawn_agent', { sessionSubagent: 'other-subagent' }, { status: 'completed' });
        expect(isControlToolSuppressedByLifecycle(otherSpawn, map)).toBe(false);
        // Non-control tools never suppressed
        expect(isControlToolSuppressedByLifecycle(makeToolCall('CodexBash', {}), map)).toBe(false);
    });

    it('keeps Claude generic tools collapsed on main transcript (S2 regression guard for 2026-04-25 scope-leak)', () => {
        for (const name of CLAUDE_GENERIC_TOOL_NAMES) {
            expect(shouldRenderToolContent(makeGrepLikeCall(name), false, true)).toBe(false);
        }
        const unknownNonCodex = makeToolCall('SomeRandomTool', { q: 'needle' }, { matches: ['file.ts'] });
        expect(shouldRenderToolContent(unknownNonCodex, false, false)).toBe(false);
        const claudeMcp = makeToolCall('mcp__resources__read', { uri: 'file://fixture.md' }, { resources: [] });
        expect(shouldRenderToolContent(claudeMcp, false, true)).toBe(false);
    });

    // #5 (Cluster C / AC-C4): the structured extractor for the read-only view.
    it('AC-C4: extractRequestUserInputSummary surfaces prompt / questions / options / answer', () => {
        // prompt-only input (no completed answer).
        const promptOnly = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', { prompt: 'What is your name?' }, undefined, 'running'),
        );
        expect(promptOnly.prompt).toBe('What is your name?');
        expect(promptOnly.questions).toEqual([]);
        expect(promptOnly.answer).toBeNull();

        // questions[] with options (label + optional description preserved — codex#4).
        const structured = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', {
                questions: [{
                    header: 'Render', question: 'Pick a renderer',
                    options: [{ label: 'WebGL', description: 'GPU accelerated' }, { label: 'Canvas' }, 'SVG'],
                }],
            }, undefined, 'running'),
        );
        expect(structured.questions).toHaveLength(1);
        expect(structured.questions[0]).toMatchObject({ header: 'Render', question: 'Pick a renderer' });
        expect(structured.questions[0].options).toEqual([
            { label: 'WebGL', description: 'GPU accelerated' },
            { label: 'Canvas', description: null },
            { label: 'SVG', description: null },
        ]);

        // completed { answers: {...} } object → flattened lines.
        const answersObj = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', { prompt: 'Q' },
                { answers: { Render: 'WebGL', Theme: 'Dark' } }, 'completed'),
        );
        expect(answersObj.answer).toBe('Render: WebGL\nTheme: Dark');

        // codex#2: a nested answers value ({ answers: [...] } or object) must be
        // flattened to its selected text, NOT raw-JSON stringified.
        const nestedAnswers = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', { prompt: 'Q' },
                { answers: { Render: { answers: ['WebGL', 'Canvas'] }, Theme: { label: 'Dark' } } }, 'completed'),
        );
        expect(nestedAnswers.answer).toBe('Render: WebGL, Canvas\nTheme: Dark');
        expect(nestedAnswers.answer).not.toContain('{');

        // completed bare string output.
        const stringOut = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', { prompt: 'Q' }, 'Friday works best', 'completed'),
        );
        expect(stringOut.answer).toBe('Friday works best');

        // completed object with answer/response/output/message precedence.
        const responseField = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', { prompt: 'Q' }, { response: 'Yes please' }, 'completed'),
        );
        expect(responseField.answer).toBe('Yes please');

        // answer is NOT read from a still-running call (no premature answer).
        const running = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', { prompt: 'Q' }, { answer: 'leaked' }, 'running'),
        );
        expect(running.answer).toBeNull();
    });

    // #5 (Cluster 5 / AC-C3): the parser MUST preserve the producer-emitted question
    // id (qid) and per-question multiSelect so the interactive RequestUserInputView can
    // (a) render radios vs checkboxes and (b) key answersRecord by qid for the C-producer
    // round-trip. Keying by header alone would break the qid->answer mapping.
    it('AC-C3: extractRequestUserInputSummary preserves qid + multiSelect for the interactive round-trip', () => {
        const withId = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', {
                questions: [{
                    id: 'q-renderer', header: 'Render', question: 'Pick a renderer', multiSelect: true,
                    options: [{ label: 'WebGL' }, { label: 'Canvas' }],
                }],
            }, undefined, 'running'),
        );
        expect(withId.questions[0].id).toBe('q-renderer');
        expect(withId.questions[0].multiSelect).toBe(true);

        // snake_case multi_select and qid alias are honored; single-select defaults false.
        const snake = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', {
                questions: [{ qid: 'q-theme', question: 'Theme?', multi_select: false, options: [{ label: 'Dark' }] }],
            }, undefined, 'running'),
        );
        expect(snake.questions[0].id).toBe('q-theme');
        expect(snake.questions[0].multiSelect).toBe(false);

        // id is null when the producer omits it (view then falls back to header).
        const noId = extractRequestUserInputSummary(
            makeToolCall('functions.request_user_input', {
                questions: [{ header: 'H', question: 'Q?', options: [{ label: 'A' }] }],
            }, undefined, 'running'),
        );
        expect(noId.questions[0].id).toBeNull();
        expect(noId.questions[0].multiSelect).toBe(false);
    });

    // #5 (Cluster 5 / AC-C3): a PENDING interactive request_user_input (running tool
    // carrying a pending permission) MUST reach the interactive view (return true) so
    // the user can answer — it is NOT force-normalized to a read-only/unavailable card.
    // A running request WITHOUT a pending permission stays header-only (return false).
    it('AC-C3: shouldRenderToolContent surfaces a pending interactive request_user_input', () => {
        const pending = makeToolCall('functions.request_user_input',
            { questions: [{ id: 'q1', question: 'Pick', options: [{ label: 'A' }] }] }, undefined, 'running');
        pending.permission = { id: 'item-123', status: 'pending' };
        // hasSpecializedView=true (view registered), minimal=true (header-only default):
        // the pending interactive request must still render its form.
        expect(shouldRenderToolContent(pending, true, true)).toBe(true);

        // No permission => legacy running request stays header-only.
        const runningNoPerm = makeToolCall('functions.request_user_input',
            { questions: [{ id: 'q1', question: 'Pick', options: [{ label: 'A' }] }] }, undefined, 'running');
        expect(shouldRenderToolContent(runningNoPerm, true, true)).toBe(false);

        // An already-approved permission is no longer pending => not forced interactive.
        const approved = makeToolCall('functions.request_user_input',
            { questions: [{ id: 'q1', question: 'Pick', options: [{ label: 'A' }] }] }, { answers: { q1: 'A' } }, 'completed');
        approved.permission = { id: 'item-123', status: 'approved' };
        // completed (non-running) request renders its read-only answer card.
        expect(shouldRenderToolContent(approved, true, true)).toBe(true);

        // codex#4: a STALE pending permission on an ERROR card must NOT take the
        // running-pending interactive branch — the error read-only path wins (also true,
        // but via the error-state gate, not the interactive gate). The point is the
        // running+pending gate does not fire for a non-running tool.
        const errorWithStalePending = makeToolCall('functions.request_user_input',
            { questions: [{ id: 'q1', question: 'Pick', options: [{ label: 'A' }] }] },
            '<tool_use_error>boom</tool_use_error>', 'error');
        errorWithStalePending.permission = { id: 'item-123', status: 'pending' };
        // renders (via the error-state gate), and the view will show the read-only error.
        expect(shouldRenderToolContent(errorWithStalePending, true, true)).toBe(true);
    });

    // #5 (Cluster C / AC-C2 + AC-C4 / OBJ-3 B11): the view-facing failure helper
    // parses internally so a RAW tool.result (string OR object) reuses the B11
    // failure logic the GenericToolPreview no longer applies once the view is
    // registered.
    it('AC-C2/B11: buildRequestUserInputFailureLineFromResult strips tags + applies object precedence on a RAW result', () => {
        // string <tool_use_error> payload (raw, unparsed) — tag stripped, body kept.
        expect(buildRequestUserInputFailureLineFromResult(
            '<tool_use_error>request_user_input is unavailable in Default mode</tool_use_error>',
        )).toContain('request_user_input is unavailable in Default mode');
        expect(buildRequestUserInputFailureLineFromResult(
            '<tool_use_error>request_user_input is unavailable in Default mode</tool_use_error>',
        )).not.toContain('<tool_use_error>');

        // object { error: '<tool_use_error>...' } payload — tag stripped via object precedence.
        const objLine = buildRequestUserInputFailureLineFromResult({ error: '<tool_use_error>stderr boom</tool_use_error>' });
        expect(objLine).toContain('stderr boom');
        expect(objLine).not.toContain('<tool_use_error>');

        // RAW JSON STRING object payload — parses internally then applies precedence (codex#6).
        const jsonString = buildRequestUserInputFailureLineFromResult(
            JSON.stringify({ stderr: 'from-stderr', error: 'from-error' }),
        );
        expect(jsonString).toContain('from-stderr');

        // multi-line failure keeps its line breaks (not collapsed to one summary line).
        expect(buildRequestUserInputFailureLineFromResult(
            '<tool_use_error>line one\nline two\nline three</tool_use_error>',
        )).toContain('line one\nline two\nline three');

        // errorless failure → non-empty fallback (never a blank body).
        expect(buildRequestUserInputFailureLineFromResult(null)).toContain('Request user input failed with no error output');

        // codex#1 (view precedence): an ERROR payload that ALSO matches the
        // 'unavailable in Default mode' phrasing must still be tag-stripped. The
        // view uses this helper (not extractRequestUserInputUnavailableReason) for
        // state==='error', so the tags never leak. (extractRequestUserInputUnavailableReason
        // returns the RAW tagged string here — the helper is the safe one.)
        const taggedUnavailable = '<tool_use_error>request_user_input is unavailable in Default mode</tool_use_error>';
        expect(buildRequestUserInputFailureLineFromResult(taggedUnavailable))
            .toContain('request_user_input is unavailable in Default mode');
        expect(buildRequestUserInputFailureLineFromResult(taggedUnavailable)).not.toContain('<tool_use_error>');
        // Proof the raw extractor would leak (justifies the view's error-first precedence).
        expect(extractRequestUserInputUnavailableReason(taggedUnavailable)).toContain('<tool_use_error>');
    });

    // #5 (Cluster C / AC-C1): once the read-only view is registered
    // (hasSpecializedView=true), a COMPLETED answer renders the card and a still-
    // RUNNING request stays header-only; the error/unavailable pre-minimal
    // exceptions remain intact regardless of minimal:true.
    it('AC-C1: request_user_input content gating with a registered view (running header-only, completed card)', () => {
        // RUNNING + registered view → header-only (false) so no padded empty content wrapper.
        const running = makeToolCall('functions.request_user_input', { prompt: 'Q' }, undefined, 'running');
        expect(shouldRenderToolContent(running, true, true)).toBe(false);

        // COMPLETED answer + registered view → card renders (true) despite minimal:true.
        const completed = makeToolCall('functions.request_user_input', {}, { answer: 'ok' }, 'completed');
        expect(shouldRenderToolContent(completed, true, true)).toBe(true);

        // FAILED → renders inline via the :222 pre-minimal exception (unaffected by the flag/view).
        const failed = makeToolCall('functions.request_user_input', {}, '<tool_use_error>x</tool_use_error>', 'error');
        expect(shouldRenderToolContent(failed, true, true)).toBe(true);

        // Completed-unavailable → renders via the :227 exception (unaffected).
        const unavailable = makeToolCall('functions.request_user_input', { question: 'q' },
            'request_user_input is unavailable in Default mode', 'completed');
        expect(shouldRenderToolContent(unavailable, true, true)).toBe(true);

        // No-view legacy path is unchanged: running stays header-only via the minimal gate.
        expect(shouldRenderToolContent(running, false, true)).toBe(false);
        // No-view legacy completed answer stays header-only (the registry-flag is load-bearing).
        expect(shouldRenderToolContent(completed, false, true)).toBe(false);
    });

    // #5 (Cluster C / AC-C3, revised task 20260703-053043): request_user_input renders the
    // interactive card INLINE and in the desktop SIDEBAR, but the click-title full DETAIL now
    // falls through to the generic structured view (Description + Input Parameters raw JSON),
    // mirroring subagent_lifecycle (AC-B1) and Claude. Source-derived so a revert fails the test.
    it('AC-C3: request_user_input is inline + sidebar, but its click-title detail is the generic structured view (not the specialized card)', () => {
        const allSrc = readFileSync(resolve(__dirname, '../components/tools/views/_all.tsx'), 'utf8');
        const inlineBlock = /export const toolViewRegistry:[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(allSrc)?.[1] ?? '';
        const fullBlock = /export const toolFullViewRegistry:[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(allSrc)?.[1] ?? '';
        // Inline: the interactive answer card.
        expect(/'functions\.request_user_input':\s*RequestUserInputView/.test(inlineBlock)).toBe(true);
        // Full-detail: NOT registered → falls through to the generic Description + Input Parameters view.
        expect(/'functions\.request_user_input':\s*RequestUserInputView/.test(fullBlock)).toBe(false);

        // NOT in SPECIALIZED_FULL_PAYLOAD_TOOLS → the generic Input Parameters section renders on the detail.
        const fullViewSrc = readFileSync(resolve(__dirname, '../components/tools/ToolFullView.tsx'), 'utf8');
        const payloadSet = /SPECIALIZED_FULL_PAYLOAD_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(fullViewSrc)?.[1] ?? '';
        expect(payloadSet).not.toContain("'functions.request_user_input'");

        // Desktop sidebar is UNCHANGED — still routes to the specialized card (B applies to the detail, not the sidebar).
        const sidebarSrc = readFileSync(resolve(__dirname, '../components/sidebar/SidebarContentRenderer.tsx'), 'utf8');
        expect(/REQUEST_USER_INPUT_TOOLS\.has\(tool\.name\)\)\s*\{\s*return <RequestUserInputView/.test(sidebarSrc)).toBe(true);
    });
});

// Item 2 (spec-20260607-124814) — AC4 (tightened, no OR escape) + AC5.
// AC4 binds the user-facing failure styling to the EXISTING reducer: the producer-emitted
// error-shaped tool-call-end output, fed through the REAL app normalization + reducer path,
// MUST yield reducer-derived is_error===true AND ToolCall.state==='error'. The test NEVER
// hand-constructs is_error/state — they are produced by typesRaw.normalizeRawMessage (which
// calls the FORBIDDEN-to-edit isSessionToolEndError internally) and reducer.ts (state =
// is_error ? 'error' : 'completed'). The ADD-ONLY helper is asserted only as an ADDITIONAL
// check, never as an alternative to the state assertion.
describe('Item 2: producer error-shape -> reducer derives ToolCall.state==error (AC4)', () => {
    // The exact tool-call-end envelope output the happy-cli producer emits for an
    // unavailable request_user_input (sessionProtocolMapper.normalizeRequestUserInputUnavailable
    // -> buildToolEndOutput = JSON.stringify({...,status:'failed',success:false,error,output})).
    // happy-app cannot import happy-cli, so the producer recipe is reproduced here as a string;
    // the is_error/state derivation under test is entirely the app reducer path, NOT this fixture.
    const PRODUCER_REASON = 'request_user_input is unavailable in Default mode';
    const producerErrorShapedOutput = JSON.stringify({
        status: 'failed',
        success: false,
        error: PRODUCER_REASON,
        output: PRODUCER_REASON,
    });

    function sessionRaw(envelope: Record<string, unknown>) {
        return { role: 'session', content: envelope } as any;
    }

    function driveThroughReducer(toolEndOutput: string) {
        const call = 'rui-call-1';
        const startEnv = {
            id: createId(), time: 1000, role: 'agent', turn: 'turn-1',
            ev: {
                t: 'tool-call-start', call, name: 'functions.request_user_input',
                title: 'request_user_input', description: 'request_user_input',
                args: { question: 'Pick one' },
            },
        };
        const endEnv = {
            id: createId(), time: 1001, role: 'agent', turn: 'turn-1',
            ev: { t: 'tool-call-end', call, output: toolEndOutput },
        };
        const normalized = [startEnv, endEnv]
            .map((env, i) => normalizeRawMessage(`rui-${i}`, null, env.time, sessionRaw(env)))
            .filter((m): m is NonNullable<typeof m> => m !== null);
        // The tool-result NormalizedMessage's is_error is set by isSessionToolEndError — read
        // it back to prove the reducer's input was derived, not hand-authored.
        const endNormalized = normalized.find((m) =>
            m.role === 'agent' && Array.isArray(m.content) && m.content[0]?.type === 'tool-result');
        const state = createReducer();
        const result = reducer(state, normalized as any);
        const toolCall = result.messages.find((m) => m.kind === 'tool-call');
        return { endNormalized, toolCall };
    }

    it('AC4: error-shaped output -> is_error===true AND ToolCall.state===error (full normalize+reducer path)', () => {
        const { endNormalized, toolCall } = driveThroughReducer(producerErrorShapedOutput);

        // (1) reducer-derived is_error on the normalized tool-result (set by isSessionToolEndError).
        expect(endNormalized).toBeDefined();
        const content = (endNormalized as any)!.content[0];
        expect(content.type).toBe('tool-result');
        expect(content.is_error).toBe(true);

        // (2) the resulting ToolCall.state — derived by reducer.ts (state = is_error?'error':'completed').
        expect(toolCall).toBeDefined();
        if (toolCall!.kind !== 'tool-call') throw new Error('expected tool-call');
        expect(toolCall!.tool.state).toBe('error');

        // ADDITIONAL (never an alternative): the ADD-ONLY helper extracts the reason.
        expect(extractRequestUserInputUnavailableReason(JSON.parse(producerErrorShapedOutput)))
            .toBe(PRODUCER_REASON);
    });

    it('AC2 (symmetric negative): a normal completed answer -> is_error===false AND state===completed', () => {
        // A normal completed answer is NOT producer-normalized, so the tool-call-end output is
        // the bare answer string (buildToolEndOutput collapse) — feed it through the same path.
        const { endNormalized, toolCall } = driveThroughReducer('Friday works best for me');
        const content = (endNormalized as any)!.content[0];
        expect(content.is_error).toBe(false);
        if (toolCall!.kind !== 'tool-call') throw new Error('expected tool-call');
        expect(toolCall!.tool.state).toBe('completed');
        // The ADD-ONLY helper returns null for a non-unavailable answer (no false positive).
        expect(extractRequestUserInputUnavailableReason('Friday works best for me')).toBeNull();
    });

    it('AC5: ADD-ONLY helper extracts reason from error field and is null for normal answers', () => {
        expect(extractRequestUserInputUnavailableReason({ error: PRODUCER_REASON })).toBe(PRODUCER_REASON);
        expect(extractRequestUserInputUnavailableReason({ output: 'request_user_input is only available in Plan mode' }))
            .toBe('request_user_input is only available in Plan mode');
        expect(extractRequestUserInputUnavailableReason({ output: 'I am unavailable tomorrow' })).toBeNull();
        expect(extractRequestUserInputUnavailableReason(null)).toBeNull();
    });
});

const CLAUDE_GENERIC_TOOL_NAMES = ['Grep', 'Glob', 'WebSearch', 'ToolSearch'] as const;

function makeToolCall(
    name: string,
    input: any,
    result?: any,
    state: 'running' | 'completed' | 'error' = 'completed',
) {
    return {
        name,
        state,
        input,
        result,
        createdAt: 0,
        startedAt: 0,
        completedAt: 1,
        description: null,
    } as any;
}

function makeGrepLikeCall(name: string) {
    return makeToolCall(name, { pattern: 'needle' }, { matches: ['file.ts'] });
}
