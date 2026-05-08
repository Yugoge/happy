import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/components/markdown/parseMarkdown';
import { parseUnifiedDiff } from './codexUnifiedDiff';
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
            'markdown-rich-detail',
            'terminal-stdout-stderr-exit',
            'patch-unified-diff',
            'update-plan',
            'parallel-tools',
            'image-view',
            'playwright-screenshot',
            'image-generation',
            'subagent-spawn',
            'subagent-wait',
            'subagent-close',
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

    it('renders Codex-sourced generic / unknown / resource tools inline (S2 forward fix)', () => {
        const listResources = makeToolCall('functions.list_mcp_resources', { server: 'Codex' }, { resources: [] });
        expect(shouldRenderToolContent(listResources, false, true)).toBe(true);
        const mcpRead = makeToolCall('mcp__resources__read', { uri: 'file://fixture.md' }, { resources: [] });
        expect(shouldRenderToolContent(mcpRead, false, true, { flavor: 'codex' } as any)).toBe(true);
        const futureTool = makeToolCall('functions.future_tool', { nested: { value: ['x'] } }, { error: 'user rejected MCP tool call' }, 'error');
        expect(shouldRenderToolContent(futureTool, false, false)).toBe(true);
        const codexBash = makeToolCall('CodexBash', {});
        expect(shouldRenderToolContent(codexBash, true, true)).toBe(true);
        const subagentControl = makeToolCall('functions.wait_agent', { name: 'fixture-agent' }, { status: 'completed' });
        expect(shouldRenderToolContent(subagentControl, true, true)).toBe(false);
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
