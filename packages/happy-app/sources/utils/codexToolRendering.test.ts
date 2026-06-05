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
    CODEX_LIFECYCLE_TOOL,
} from './codexToolRendering';

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
        // hasSpecializedView ⇔ the MCP name maps to CodexAttachmentView in BOTH registry BLOCKS.
        // Slice each registry object body so a false-pass (both occurrences landing in one block
        // or a comment) cannot occur — assert the entry inside EACH block separately (codex ISSUE 1).
        const inlineBlock = /export const toolViewRegistry:[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(allSrc)?.[1] ?? '';
        const fullBlock = /export const toolFullViewRegistry:[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(allSrc)?.[1] ?? '';
        const attachmentEntry = new RegExp(`'${MCP_NAME}':\\s*CodexAttachmentView`);
        expect(attachmentEntry.test(inlineBlock)).toBe(true); // inline ToolView card
        expect(attachmentEntry.test(fullBlock)).toBe(true);   // detail/full view
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

    // AC1/AC7 (sidebar registry): the SidebarContentRenderer ATTACHMENT_TOOLS Set must contain
    // BOTH image_gen aliases so the RightSidebar (desktop panel + mobile modal share this gate)
    // routes them to CodexAttachmentView (inline image) instead of the SidebarGenericView JSON-only
    // fallback. Registry-derived from the actual SidebarContentRenderer.tsx source.
    it('routes both image_gen aliases through the sidebar ATTACHMENT_TOOLS gate — AC1/AC7', () => {
        const sidebarSrc = readFileSync(resolve(__dirname, '../components/sidebar/SidebarContentRenderer.tsx'), 'utf8');
        const setMatch = /const ATTACHMENT_TOOLS = new Set\(\[([^\]]*)\]\)/.exec(sidebarSrc);
        expect(setMatch).toBeTruthy();
        const members = setMatch![1];
        expect(members).toContain("'mcp__image_gen__imagegen'");
        expect(members).toContain("'image_gen.imagegen'");
        // The gate routes members to CodexAttachmentView (inline), not SidebarGenericView (JSON-only).
        expect(/ATTACHMENT_TOOLS\.has\(tool\.name\)\)\s*\{?\s*\n?\s*return <CodexAttachmentView/.test(sidebarSrc)).toBe(true);
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
